# Safety Rules for SSH Bridge Setup

## Core Principle

**Do no harm.** Establishing a tunnel must never break existing working connections, tools, or configurations.

## Before ANY config modification

1. **Snapshot first**:
   ```bash
   cp ~/.ssh/config ~/.ssh/config.bak.$(date +%s) 2>/dev/null || true
   ```

2. **Record pre-existing state**:
   ```bash
   echo "=== Pre-flight state $(date) ==="
   ssh -T git@github.com 2>&1 | head -1        # GitHub SSH
   gh auth status 2>&1 | head -2                # GitHub CLI
   cat ~/.ssh/config 2>/dev/null                 # SSH config
   ss -tlnp | grep -E '222[0-9]|902[0-9]'       # Ports in tunnel range
   ```

3. **Append, never overwrite**: Use `cat >>` or `tee -a`, never `cat >` or `echo >`

## Files that must NEVER be overwritten or truncated

| File | Contains | Impact if lost |
|------|----------|---------------|
| `~/.ssh/config` | SSH aliases for GitHub, other servers | Git push/pull breaks, other SSH access lost |
| `~/.ssh/authorized_keys` | Authorized login keys | Locked out of server |
| `~/.ssh/known_hosts` | Trusted host fingerprints | Selective removal OK, never truncate |
| `~/.config/gh/hosts.yml` | GitHub CLI auth tokens | `gh` commands stop working |
| `~/.gitconfig` | Git credentials, proxy settings | Git operations break |
| `~/.bashrc`, `~/.profile` | ENV vars, PATH, tokens | Tools and services break |

## Forbidden actions without explicit human approval

- Restarting sshd on any server
- Modifying firewall rules (iptables, ufw, nftables)
- Killing processes (especially existing SSH sessions)
- Modifying `/etc/ssh/sshd_config` on any server
- Running `ssh-keygen` with `-f` pointing to an existing key file (overwrites it)

## After tunnel is established

Verify nothing was broken:
```bash
ssh -T git@github.com 2>&1 | head -1    # Should still work
gh auth status 2>&1 | head -2            # Should still work
# Test any other SSH connections that were working before
```

## When debugging fails

1. **STOP** after 3 failed attempts at the same approach
2. **Report** what was tried, what was observed, what is recommended
3. **Do NOT** cycle through brute-force fixes (randomly changing ports, keys, configs)
4. **Ask the human** for more information about their network topology
