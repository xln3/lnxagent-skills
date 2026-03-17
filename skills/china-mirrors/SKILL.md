---
name: china-mirrors
description: Configure package manager mirrors for a server in China where Docker Hub, HuggingFace, PyPI, and other package sources are blocked or slow. Detects what's blocked and configures the fastest available mirrors automatically.
argument-hint: [check|apply]
allowed-tools: Bash, Read, Write, Edit
---

# China Mirror Configuration

You need to configure a server in China (or behind the GFW) to use accessible mirrors for blocked package sources.

## Step 1: Detect What's Blocked

Run this diagnostic first — it determines the entire mirror strategy:

```bash
echo "=== Network Accessibility Test ==="
declare -A SITES=(
  ["Docker Hub"]="https://registry-1.docker.io/v2/"
  ["Docker download"]="https://download.docker.com/linux/ubuntu/gpg"
  ["PyPI"]="https://pypi.org"
  ["HuggingFace"]="https://huggingface.co"
  ["HF Mirror"]="https://hf-mirror.com"
  ["GitHub"]="https://github.com"
  ["NPM"]="https://registry.npmjs.org"
  ["PyTorch"]="https://download.pytorch.org/whl/cpu/"
  ["Aliyun Mirror"]="https://mirrors.aliyun.com"
  ["Tsinghua Mirror"]="https://pypi.tuna.tsinghua.edu.cn/simple/"
)
for name in "${!SITES[@]}"; do
  code=$(curl -s --connect-timeout 5 -o /dev/null -w "%{http_code}" "${SITES[$name]}" 2>/dev/null)
  status="OK"
  [ "$code" = "000" ] || [ "$code" = "" ] && status="BLOCKED"
  [ "$code" = "403" ] && status="FORBIDDEN"
  printf "%-20s %s (HTTP %s)\n" "$name" "$status" "$code"
done
```

## Step 2: Apply Mirrors Based on Results

### Docker Hub BLOCKED → Aliyun Docker CE repo + image transfer

```bash
# Docker CE installation (apt source)
curl -fsSL https://mirrors.aliyun.com/docker-ce/linux/ubuntu/gpg -o /tmp/docker.gpg
gpg --dearmor -o /etc/apt/keyrings/docker.gpg < /tmp/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://mirrors.aliyun.com/docker-ce/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
```

**DO NOT** add registry-mirrors to `/etc/docker/daemon.json` — most Chinese Docker mirrors are dead as of 2025. Instead, transfer images via `docker save/load`.

### PyPI slow → Aliyun PyPI mirror

```bash
# System pip
pip3 config set global.index-url https://mirrors.aliyun.com/pypi/simple/
pip3 config set global.trusted-host mirrors.aliyun.com

# Inside Dockerfile
RUN pip config set global.index-url https://mirrors.aliyun.com/pypi/simple/ && \
    pip config set global.trusted-host mirrors.aliyun.com
```

Alternative: Tsinghua mirror (`https://pypi.tuna.tsinghua.edu.cn/simple/`)

### HuggingFace BLOCKED → hf-mirror.com

```bash
# Environment variable (affects huggingface-hub, transformers, etc.)
export HF_ENDPOINT=https://hf-mirror.com

# In scripts or .bashrc
echo 'export HF_ENDPOINT=https://hf-mirror.com' >> ~/.bashrc

# For Docker containers, add to docker-compose.yml:
environment:
  HF_ENDPOINT: "https://hf-mirror.com"
```

### PyTorch too large → CPU-only wheels

If the server has no GPU, install CPU-only torch (200MB vs 2.5GB):

```bash
pip install torch --index-url https://download.pytorch.org/whl/cpu
```

In Dockerfile, add BEFORE other pip installs:
```dockerfile
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu
```

### NPM slow → npmmirror

```bash
npm config set registry https://registry.npmmirror.com
```

### Ubuntu apt slow → Tsinghua or Aliyun

```bash
sed -i 's|http://archive.ubuntu.com|https://mirrors.aliyun.com|g' /etc/apt/sources.list
sed -i 's|http://security.ubuntu.com|https://mirrors.aliyun.com|g' /etc/apt/sources.list
```

## Common Gotchas

1. **Docker Hub mirrors are dead** — Don't waste time configuring `registry-mirrors`. Just transfer images with `docker save | gzip | ssh target "gunzip | docker load"`.

2. **GPG key corruption** — If `gpg --dearmor` fails with "Failed writing body", delete the output file first: `rm -f /etc/apt/keyrings/docker.gpg`

3. **pip inside Docker build** — `network: host` in docker-compose build section gives the build container access to host network and mirrors.

4. **HF_ENDPOINT vs HF_MIRROR** — Use `HF_ENDPOINT` (the official env var recognized by huggingface-hub library).

5. **Proxy vs mirrors** — If the server has a working HTTP proxy (e.g., mihomo at 127.0.0.1:7890), configure Docker daemon proxy instead of mirrors. Proxy is more reliable but requires a running proxy service.
