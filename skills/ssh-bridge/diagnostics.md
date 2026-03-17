# SSH Bridge Diagnostics

## Quick Diagnostic Command

Run this single block to diagnose most issues:

```bash
TUNNEL_PORT=2223  # ← set to your tunnel port

echo "=== 1. Tunnel port listening? ==="
ss -tlnp | grep $TUNNEL_PORT || echo "NOT LISTENING — tunnel is down"

echo ""
echo "=== 2. Loopback check ==="
TUNNEL_FP=$(ssh-keyscan -p $TUNNEL_PORT 127.0.0.1 2>/dev/null | grep ed25519 | awk '{print $3}')
LOCAL_FP=$(cat /etc/ssh/ssh_host_ed25519_key.pub 2>/dev/null | awk '{print $2}')
if [ "$TUNNEL_FP" = "$LOCAL_FP" ]; then
    echo "LOOPBACK DETECTED — tunnel connects back to this server!"
elif [ -z "$TUNNEL_FP" ]; then
    echo "NO RESPONSE — tunnel port not responding to SSH"
else
    echo "OK — reaches a different server"
fi

echo ""
echo "=== 3. Auth test ==="
ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 -p $TUNNEL_PORT root@127.0.0.1 "echo OK" 2>&1

echo ""
echo "=== 4. Existing connections ==="
ssh -T git@github.com 2>&1 | head -1
gh auth status 2>&1 | head -2
```

## Decision Tree

```
Tunnel port not listening?
├─ Human's PC disconnected → ask them to re-run the tunnel command
├─ Human ran command on wrong port → verify Server A's actual SSH port
└─ Firewall blocking → check `sudo ufw status` or `sudo iptables -L`

Tunnel loops back to self?
├─ Tunnel port = Server A's SSH port → pick a different port (e.g., 9022)
└─ Server A has another service on that port → check `ss -tlnp | grep <PORT>`

Permission denied (publickey)?
├─ Key not in Server B's authorized_keys → re-run key copy command
├─ Wrong key being offered → check `ssh -vvv` output for "Offering" lines
├─ Non-standard key name → add `IdentityFile` to SSH config or use `-i`
├─ authorized_keys wrong permissions → must be 600, .ssh must be 700
└─ sshd_config restricts keys → check `/etc/ssh/sshd_config.d/*.conf`

Connection timed out?
├─ Bridge PC lost VPN → ask human to check VPN status
├─ WSL2 can't reach target → try from Windows CMD/PowerShell instead
└─ Target server sshd not running → ask human to verify on target

Connection refused?
├─ Target sshd not running → ask human: `systemctl status sshd`
├─ Wrong SSH port for target → verify target's actual SSH port
└─ Target firewall blocks port → ask human to check on target

Host key verification failed?
├─ First connection → use `-o StrictHostKeyChecking=no`
├─ Known hosts conflict → `ssh-keygen -R '[127.0.0.1]:<PORT>'`
└─ No ssh-askpass installed → use StrictHostKeyChecking=no
```

## Common Mistakes Reference

| Mistake | Symptom | Fix |
|---------|---------|-----|
| Tunnel port = SSH port | Silent loopback, misleading "Permission denied" | Use different port |
| `ServerAliveCountdown` | "Bad configuration option" error | Correct: `ServerAliveCountMax` |
| Default port 22 assumed | "Connection timed out" on tunnel setup | Check actual SSH port with `grep Port /etc/ssh/sshd_config` |
| Non-standard key name | "Permission denied" despite correct authorized_keys | Use `-i ~/.ssh/<keyname>` or IdentityFile in config |
| WSL2 + Windows VPN | Tunnel connects but auth fails (loopback) | Try from Windows CMD instead |
| `autossh` not available | Package not found | Use plain `ssh` with `ServerAliveInterval`/`ServerAliveCountMax` |
