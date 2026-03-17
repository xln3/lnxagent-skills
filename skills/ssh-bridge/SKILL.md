---
name: ssh-bridge
description: Establish SSH access to a remote server through a human's VPN-gated PC as bridge. Use when you need to reach a server that is not directly accessible from your current machine, but the human can reach both. Guides information gathering, key setup, tunnel creation, and verification — with built-in diagnostics for common failures.
argument-hint: [target-description]
allowed-tools: Bash, Read, Write, Edit, Grep
---

# SSH Bridge — Connect to a Remote Server via Human's PC

You need to establish an SSH connection to a remote server that you cannot reach directly.
The human's PC (with VPN or network access) will act as a bridge.

**Target**: $ARGUMENTS

## Phase 1: Gather Information (ASK THE HUMAN)

You MUST collect all 7 facts before attempting any commands.
Present this as a checklist and ask the human to fill in the answers.

```
I need the following information to set up the SSH bridge:

1. SERVER A (this machine — I'll auto-detect what I can):
   - SSH port: [I'll check with `grep Port /etc/ssh/sshd_config`]
   - Username: [I'll check with `whoami`]
   - IP/hostname the human uses to connect: [ASK HUMAN]

2. SERVER B (target):
   - IP address (as seen from your PC): ___
   - SSH port (usually 22): ___
   - Username to log in as: ___
   - Auth method — password or key-only?: ___

3. BRIDGE (human's PC):
   - Connecting from WSL2, Windows CMD, Mac Terminal, or Linux?: ___
   - VPN required to reach Server B?: ___
```

### Auto-detect Server A info:
```bash
echo "=== Server A Auto-Detection ==="
echo "Username: $(whoami)"
echo "Hostname: $(hostname)"
echo "SSH Port: $(grep -E '^Port ' /etc/ssh/sshd_config 2>/dev/null || echo '22 (default)')"
echo "SSH Keys:"
ls -1 ~/.ssh/*.pub 2>/dev/null || echo "  No keys found — will need to generate one"
echo "Existing SSH config entries:"
grep '^Host ' ~/.ssh/config 2>/dev/null || echo "  (none)"
echo "Ports already in use (2222-2230 range):"
ss -tlnp | grep -E '222[0-9]' 2>/dev/null || echo "  (none)"
echo "gh auth status:"
gh auth status 2>&1 | head -2
```

**IMPORTANT**: Do NOT proceed until all 7 facts are confirmed.

---

## Phase 2: Pre-Flight Safety Checks

Before modifying ANY config file, back up existing state:

```bash
# Back up SSH config
cp ~/.ssh/config ~/.ssh/config.bak.$(date +%s) 2>/dev/null || true

# Record current working connections for post-setup verification
echo "=== Pre-flight connectivity check ==="
ssh -T git@github.com 2>&1 | head -1
gh auth status 2>&1 | head -2
```

**SAFETY RULES** (see [safety-rules.md](safety-rules.md) for full details):
- NEVER overwrite config files — always append
- NEVER restart sshd without human approval
- NEVER modify firewall rules without human approval
- Document every change you make

---

## Phase 3: SSH Key Setup

### If Server A has no SSH key:
```bash
ssh-keygen -t ed25519 -N '' -f ~/.ssh/id_ed25519 -C "$(whoami)@$(hostname)"
```

### Give the human the command to copy the key to Server B:

Determine the key file:
```bash
ls ~/.ssh/*.pub
cat ~/.ssh/<KEY_NAME>.pub
```

Then tell the human:
```
Please run this on your PC to authorize my key on Server B:

ssh <B_USER>@<B_IP> "mkdir -p ~/.ssh && echo '<FULL_PUBLIC_KEY>' >> ~/.ssh/authorized_keys && chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys"
```

Wait for human confirmation before proceeding.

---

## Phase 4: Choose Tunnel Port

**CRITICAL**: The tunnel port must NOT collide with any port already in use on Server A.

```bash
# Check which ports are in use
ss -tlnp | grep -E '222[0-9]|902[0-9]'

# Check Server A's own SSH port
grep -E '^Port ' /etc/ssh/sshd_config 2>/dev/null || echo "SSH on default port 22"
```

**Port selection rules:**
- If Server A SSH is on port 22 → use 2222 for tunnel
- If Server A SSH is on port 2222 → use 2223 for tunnel
- If in doubt, use 9022 (unlikely to collide with anything)
- ALWAYS verify the chosen port is free: `ss -tlnp | grep <PORT>`

---

## Phase 5: Instruct the Human to Open the Tunnel

Generate the EXACT command for the human to run on their PC:

```
Please run this command on your PC and keep the terminal open:

ssh -o "ServerAliveInterval 30" -o "ServerAliveCountMax 3" \
  -p <A_SSH_PORT> \
  -R <TUNNEL_PORT>:<B_IP>:<B_SSH_PORT> \
  <A_USER>@<A_IP>

Once connected, tell me and I'll verify the tunnel.
```

**If WSL2 + VPN**: Warn the human that WSL2 may not have access to VPN routes.
If the tunnel doesn't work from WSL2, they should try from Windows CMD/PowerShell instead.

---

## Phase 6: Verify the Tunnel

Run these checks IN ORDER. Stop at the first failure and diagnose.

### Check 1: Is the tunnel port listening?
```bash
ss -tlnp | grep <TUNNEL_PORT>
```
- If NOT listening → tunnel isn't established. Ask human to check their terminal.

### Check 2: Is it reaching the RIGHT server? (not looping back)
```bash
# Get fingerprint from tunnel
TUNNEL_FP=$(ssh-keyscan -p <TUNNEL_PORT> 127.0.0.1 2>/dev/null | grep ed25519 | awk '{print $3}')

# Get Server A's own fingerprint
LOCAL_FP=$(cat /etc/ssh/ssh_host_ed25519_key.pub 2>/dev/null | awk '{print $2}')

if [ "$TUNNEL_FP" = "$LOCAL_FP" ]; then
    echo "FAILURE: Tunnel is looping back to THIS server!"
    echo "Cause: tunnel port likely collides with Server A's SSH port"
    echo "Fix: use a different tunnel port"
else
    echo "OK: Tunnel reaches a different server"
fi
```
- If looping back → port collision. Pick a different tunnel port and redo Phase 5.

### Check 3: Can we authenticate?
```bash
ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 \
  -i ~/.ssh/<KEY_NAME> -p <TUNNEL_PORT> <B_USER>@127.0.0.1 \
  "echo 'SUCCESS: $(hostname) $(whoami) HOME=$HOME'"
```
- If "Permission denied" → key not in authorized_keys on Server B. Redo Phase 3.
- If "Connection refused" → Server B's sshd not running or wrong port.
- If "Connection timed out" → tunnel isn't forwarding (VPN/network issue on bridge PC).

### Check 4: Verify pre-existing connections still work
```bash
ssh -T git@github.com 2>&1 | head -1
gh auth status 2>&1 | head -2
```
- If broken → check ~/.ssh/config for accidental overwrites. Restore from backup.

---

## Phase 7: Configure SSH Alias

Only after Check 3 succeeds:

```bash
cat >> ~/.ssh/config << 'EOF'

Host target-server
    HostName 127.0.0.1
    Port <TUNNEL_PORT>
    User <B_USER>
    IdentityFile ~/.ssh/<KEY_NAME>
    StrictHostKeyChecking no
EOF
```

Final test:
```bash
ssh target-server "echo 'Bridge established successfully' && hostname && whoami && uname -a"
```

---

## Phase 8: Report Results

Summarize to the human:
```
SSH bridge established successfully.

  Server A (here) ──tunnel:PORT──► Server B
  Alias: ssh target-server
  Target: USER@IP (HOME=...)
  OS: ...

  ⚠️  The tunnel requires your PC to stay on and connected.
  If it disconnects, re-run:
    ssh -o "ServerAliveInterval 30" -o "ServerAliveCountMax 3" \
      -p <A_SSH_PORT> -R <TUNNEL_PORT>:<B_IP>:<B_SSH_PORT> <A_USER>@<A_IP>
```

---

## Troubleshooting Decision Tree

See [diagnostics.md](diagnostics.md) for the full diagnostic flowchart.
