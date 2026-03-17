---
name: migrate-server
description: Migrate a running production system to another server. Surveys both servers, plans transfer strategy (git vs SCP vs rebuild), handles blocked registries, configures mirrors, uses nohup for resilience, and verifies at every step. Use when moving a dockerized application between servers.
argument-hint: [target-ssh-command]
allowed-tools: Bash, Read, Write, Edit, Grep, Glob, Agent
---

# Server Migration — Systematic Production System Transfer

You need to migrate a running production system from the current server (source) to another server (target).

**CRITICAL LESSON**: The #1 time sink in migration is discovering problems AFTER you've started. Survey everything FIRST, plan SECOND, execute THIRD.

## Phase 0: Pre-Flight Survey (DO THIS BEFORE ANYTHING ELSE)

### 0.1 Survey BOTH Servers in Parallel

Run this on BOTH source and target:

```bash
echo "=== OS ===" && cat /etc/os-release | head -4
echo "=== CPU ===" && nproc && lscpu | grep "Model name"
echo "=== Memory ===" && free -h | head -2
echo "=== Disk ===" && df -h / /home 2>/dev/null
echo "=== GPU ===" && nvidia-smi 2>/dev/null || echo "No GPU"
echo "=== Docker ===" && docker --version 2>/dev/null || echo "Not installed"
echo "=== Python ===" && python3 --version 2>/dev/null
echo "=== Node ===" && node --version 2>/dev/null || echo "Not installed"
echo "=== Git ===" && git --version 2>/dev/null
echo "=== User ===" && whoami && echo "HOME=$HOME"
```

### 0.2 Test Target Network Accessibility (CRITICAL — DO THIS FIRST)

```bash
for url in \
  "https://registry-1.docker.io/v2/" \
  "https://pypi.org" \
  "https://mirrors.aliyun.com/pypi/simple/" \
  "https://huggingface.co" \
  "https://hf-mirror.com" \
  "https://github.com" \
  "https://registry.npmjs.org" \
  "https://download.docker.com/linux/ubuntu/gpg" \
  "https://mirrors.aliyun.com/docker-ce/linux/ubuntu/gpg" \
  "https://download.pytorch.org/whl/cpu/"; do
  code=$(curl -s --connect-timeout 5 -o /dev/null -w "%{http_code}" "$url" 2>/dev/null)
  echo "$url → HTTP $code"
done
```

Record which sites are BLOCKED (HTTP 000 or timeout). This determines your entire mirror strategy.

### 0.3 Inventory Source Data

Classify everything into 4 categories:

| Category | Transfer Method | Examples |
|----------|----------------|----------|
| **Git-tracked code** | Push to GitHub → Clone on target | Source code, configs, docs |
| **Secrets** | SCP (small, fast) | .env files, credentials |
| **Persistent data** | SCP or rsync | Database dumps, eval results, uploaded files |
| **Rebuildable artifacts** | Rebuild on target | node_modules, .venvs, Docker images, caches |

Key commands to identify non-git data:
```bash
# Find large directories not in git
du -sh */ .*/  | sort -rh | head -20
# Find .env and secret files
find . -name ".env" -o -name "*.key" -o -name "credentials*" 2>/dev/null
# Find non-git runtime data
find . -maxdepth 3 -type d -not -path '*/.git/*' -not -path '*/node_modules/*' | while read d; do
  git ls-files --error-unmatch "$d" 2>/dev/null || echo "NOT IN GIT: $d ($(du -sh "$d" 2>/dev/null | cut -f1))"
done
# Database credentials
grep -r "DATABASE_URL\|POSTGRES" .env* 2>/dev/null
```

### 0.4 Identify Non-Downloadable Data

Ask explicitly: **"Is there any data that cannot be re-downloaded from the internet?"**

Examples from past migrations:
- MM-SafetyBench dataset (512MB, removed from source website)
- Custom training data
- Proprietary model weights

These MUST be transferred. Everything else can potentially be rebuilt.

## Phase 1: Prepare Source

1. Push all git repos to remote (GitHub/GitLab)
2. Database dump: `pg_dump -U <user> -d <db> --clean --if-exists > dump.sql`
   - **VERIFY the username**: check `.env` for `POSTGRES_USER`, not assume "postgres"
3. List Docker images needed: `grep '^FROM ' Dockerfile*`

## Phase 2: Install Target Prerequisites

**Order matters**: Install in dependency order.

1. **Docker** — Use Aliyun mirror if `download.docker.com` is blocked:
   ```bash
   curl -fsSL https://mirrors.aliyun.com/docker-ce/linux/ubuntu/gpg -o /tmp/docker.gpg
   gpg --dearmor -o /etc/apt/keyrings/docker.gpg < /tmp/docker.gpg
   echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
     https://mirrors.aliyun.com/docker-ce/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
     > /etc/apt/sources.list.d/docker.list
   apt-get update && apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
   ```

2. **Node.js** — NodeSource usually works directly:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
   apt-get install -y nodejs
   ```

3. **Docker base images** — If Docker Hub is blocked, transfer from source:
   ```bash
   # On source:
   docker save image:tag | gzip | ssh TARGET "cat > /tmp/image.tar.gz"
   # On target:
   gunzip -c /tmp/image.tar.gz | docker load
   ```

4. **GitHub access** — HTTPS with token is simpler than SSH key:
   ```bash
   git config --global credential.helper store
   echo "https://USER:TOKEN@github.com" > ~/.git-credentials
   chmod 600 ~/.git-credentials
   ```

## Phase 3: Clone Code

```bash
git clone https://github.com/ORG/REPO.git
```

Verify: `git log --oneline -1` must match source.

## Phase 4: Transfer Non-Git Data

- SCP .env files and database dump
- Restore DB: `docker exec -i CONTAINER psql -U USER -d DB < dump.sql`
- Transfer non-downloadable datasets

## Phase 5: Adapt Paths

Common changes when user/HOME differs:
```bash
# Find all hardcoded paths
grep -r "/home/olduser" docker-compose.yml .env* *.yaml *.yml
# Replace
sed -i 's|/home/olduser|/root|g' docker-compose.yml .env
```

Also check:
- Proxy settings (remove if target has direct internet)
- Docker GID (`getent group docker | cut -d: -f3`)
- Symlinks

## Phase 6: Build & Start

**ALWAYS use nohup for Docker builds** (they take 10+ minutes):

```bash
cat > /root/build.sh <<'SCRIPT'
#!/bin/bash
exec > /root/build.log 2>&1
cd /path/to/project
docker compose build 2>&1
docker compose up -d
sleep 15
docker compose ps
echo "=== DONE at $(date) ==="
SCRIPT
chmod +x /root/build.sh
nohup /root/build.sh &
```

### If pip install is slow (China servers):

Patch Dockerfile to use mirrors:
```dockerfile
RUN pip config set global.index-url https://mirrors.aliyun.com/pypi/simple/ && \
    pip config set global.trusted-host mirrors.aliyun.com
# For CPU-only torch (saves 2GB+):
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu
```

## Phase 7: Verify

Test ALL endpoints, not just the homepage:
```bash
TOKEN=$(curl -s -X POST http://localhost:PORT/auth/login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=USER&password=PASS" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

for path in "/" "/api/health" "/api/data"; do
  code=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN" "http://localhost:PORT${path}")
  echo "$path → HTTP $code"
done
```

## Phase 8: Background Data Sync

For large caches/datasets, use the nohup-on-target pattern:

```bash
ssh TARGET bash <<'EOF'
cat > /root/sync-task.sh <<'SCRIPT'
#!/bin/bash
exec > /root/sync-task.log 2>&1
# ... download/transfer commands ...
SCRIPT
chmod +x /root/sync-task.sh
nohup /root/sync-task.sh &
echo "PID: $!"
EOF
```

## Anti-Patterns (Things That Wasted Hours)

1. **Don't SCP large files through an unstable tunnel** — use rsync --partial or download directly on target
2. **Don't attempt Docker build before testing network** — always survey blocked sites first
3. **Don't run long commands through SSH tunnel without nohup** — tunnel WILL drop
4. **Don't assume pg_dump user is "postgres"** — check .env for actual POSTGRES_USER
5. **Don't use default PyPI on Chinese servers** — always configure Aliyun mirror first
6. **Don't transfer venvs/node_modules** — rebuild on target (they're platform-specific)
7. **Don't forget non-git runtime data** — scan for data/, logs/, uploads/, .data/ directories
8. **Don't skip host key verification on first connect** — use `StrictHostKeyChecking=accept-new` not `no`
