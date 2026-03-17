---
name: resilient-remote
description: Run long-running tasks on a remote server through an unstable SSH connection. Uses nohup scripts, rsync with resume, and retry patterns so operations survive tunnel drops. Use when you need to run builds, transfers, or downloads through a connection that may disconnect.
argument-hint: [task-description]
allowed-tools: Bash, Read, Write, Edit
---

# Resilient Remote Operations

You need to run a long operation on a remote server, but the SSH connection is unstable (e.g., through a VPN tunnel, flaky network). The operation must survive disconnects.

## Core Pattern: Deploy-and-Detach

**NEVER** run long commands directly through SSH. Instead:

1. Write a self-contained script
2. Deploy it to the remote server
3. Run it with `nohup`
4. Check results later

```bash
ssh TARGET bash <<'EOF'
cat > /root/TASK_NAME.sh <<'SCRIPT'
#!/bin/bash
exec > /root/TASK_NAME.log 2>&1
set -x
echo "$(date) === Starting ==="

# ... your actual work here ...

echo "$(date) === DONE ==="
SCRIPT
chmod +x /root/TASK_NAME.sh
nohup /root/TASK_NAME.sh &
echo "Launched PID $! — monitor: tail -f /root/TASK_NAME.log"
EOF
```

### Key Elements

- `exec > LOG 2>&1` — Redirects ALL output to log file (stdout + stderr)
- `set -x` — Traces every command for debugging
- `nohup ... &` — Detaches from SSH session, survives disconnect
- `$(date)` markers — Know when each step happened

### Check Progress (anytime, even after reconnect)

```bash
ssh TARGET "tail -20 /root/TASK_NAME.log"
ssh TARGET "ps -p PID -o pid,etime,pcpu,args"  # still running?
```

## Pattern: Resilient File Transfer (rsync)

**NEVER use bare `scp` for large files through unstable connections.** Use rsync:

```bash
# Retry loop with rsync --partial (resumes from last byte)
for attempt in 1 2 3 4 5; do
    rsync -az --partial --timeout=60 \
      -e "ssh -p PORT -o ConnectTimeout=10 -o ServerAliveInterval=15" \
      /source/path/ \
      user@target:/dest/path/
    [ $? -eq 0 ] && echo "OK" && break
    echo "Attempt $attempt failed, retrying in 10s..."
    sleep 10
done
```

Key flags:
- `--partial` — Keep partially transferred files, resume next time
- `--timeout=60` — Don't hang forever on stalled connection
- `-az` — Archive mode + compression
- `ServerAliveInterval=15` — Detect dead connections faster

## Pattern: Background Transfer Script

For transferring multiple directories:

```bash
cat > /tmp/transfer.sh <<'SCRIPT'
#!/bin/bash
exec > /tmp/transfer.log 2>&1

DEST="user@target"
SSH_OPTS="-p PORT -o ConnectTimeout=10 -o ServerAliveInterval=15"

for dir in /path/to/data/*/; do
    name=$(basename "$dir")
    echo "$(date) Transferring $name ($(du -sh "$dir" | cut -f1))..."
    for attempt in 1 2 3 4 5; do
        rsync -az --partial --timeout=60 -e "ssh $SSH_OPTS" \
            "$dir" "$DEST:/dest/$name/"
        [ $? -eq 0 ] && echo "$(date) $name OK" && break
        echo "$(date) $name attempt $attempt failed, retrying..."
        sleep 10
    done
done
echo "$(date) ALL TRANSFERS COMPLETE"
SCRIPT
chmod +x /tmp/transfer.sh
nohup /tmp/transfer.sh &
```

## Pattern: Download on Target (Preferred)

If the target can reach the download source directly, ALWAYS prefer downloading on target over transferring through the tunnel:

```bash
ssh TARGET bash <<'EOF'
cat > /root/download.sh <<'SCRIPT'
#!/bin/bash
exec > /root/download.log 2>&1

# Configure mirrors if needed
export HF_ENDPOINT=https://hf-mirror.com
pip3 config set global.index-url https://mirrors.aliyun.com/pypi/simple/

# Download directly on target
python3 -c "
from huggingface_hub import snapshot_download
snapshot_download('model/name', cache_dir='/root/.cache/huggingface/hub')
"

echo "$(date) DONE"
SCRIPT
chmod +x /root/download.sh
nohup /root/download.sh &
echo "PID: $!"
EOF
```

## Anti-Patterns

| Bad | Good | Why |
|-----|------|-----|
| `ssh TARGET "docker compose build"` | nohup script | Build takes 30+ min, tunnel will drop |
| `scp bigfile.tar.gz TARGET:/path/` | rsync --partial | SCP can't resume, wastes all progress |
| `ssh TARGET "pip install ..."` | nohup + log redirect | pip downloads take 10+ min |
| Transfer 29GB cache through tunnel | Download on target via mirror | Direct download is 10x faster |
| Run transfer, wait, check, retry manually | Retry loop in script | Script handles retries automatically |

## Tunnel Health Checks

Before running operations through a tunnel, always verify:

```bash
# 1. Port is listening
ss -tlnp | grep TUNNEL_PORT

# 2. Not a stale binding (compare host keys)
ssh-keyscan -p TUNNEL_PORT 127.0.0.1 2>/dev/null | awk '{print $3}'
# Compare with target's actual key — if they match source server, it's looping back!

# 3. Kill stale bindings
sudo ss -tlnp | grep TUNNEL_PORT  # find PID
sudo kill STALE_PID
# Then re-establish tunnel
```

## Decision Tree

```
Need to run something on remote server?
├── Will it take < 1 minute? → Run directly via SSH
├── Will it take 1-10 minutes? → Use nohup, check log after
└── Will it take > 10 minutes?
    ├── Can target download directly? → Deploy download script with nohup on TARGET
    └── Must transfer from source? → rsync --partial with retry loop, nohup on SOURCE
```
