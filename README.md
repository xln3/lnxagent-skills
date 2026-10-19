# lnxagent-skills

Custom Claude Code skills for LLM agent operations.

## Skills

| Skill | Command | Description |
|-------|---------|-------------|
| [ssh-bridge](skills/ssh-bridge/) | `/ssh-bridge` | Connect to a remote server through a human's VPN-gated PC as bridge |
| [migrate-server](skills/migrate-server/) | `/migrate-server` | Migrate a running production system to another server (survey → plan → execute → verify) |
| [china-mirrors](skills/china-mirrors/) | `/china-mirrors` | Configure package mirrors for China servers (Docker Hub, PyPI, HuggingFace, NPM) |
| [resilient-remote](skills/resilient-remote/) | `/resilient-remote` | Run long operations through unstable SSH connections (nohup, rsync resume, retry) |
| [wudi-renhua-editor](skills/wudi-renhua-editor/) | `/wudi-renhua-editor` | Rewrite Chinese AI-like or formulaic prose into accurate, concrete, natural language |
| [workflow-diagram](skills/workflow-diagram/) | `/workflow-diagram` | Generate editable draw.io workflows and storyboard animations from business documents or sketches |

## Installation

Symlink into your personal Claude Code skills directory:

```bash
# Link all skills at once
for skill in skills/*/; do
    name=$(basename "$skill")
    ln -sfn "$(pwd)/$skill" ~/.claude/skills/"$name"
done
```

Or link individual skills:

```bash
ln -sfn /path/to/lnxagent-skills/skills/ssh-bridge ~/.claude/skills/ssh-bridge
```

## Documentation

| Document | Description |
|----------|-------------|
| [腾讯云反向 SSH 中转配置](docs/tencent-ssh-relay-setup.md) | 脱敏、参数化的反向 SSH 隧道、受限跳板账号、外部使用者开通、自动重连和撤销流程 |
| [SSH 中转配置会话记录](docs/session-ssh-relay-2026-10-19.md) | 本次方案设计、故障判断、验证结果和后续维护原则 |

## Adding New Skills

1. Create a directory under `skills/<skill-name>/`
2. Add `SKILL.md` with frontmatter (see existing skills for format)
3. Add supporting files (diagnostics, safety rules, templates, etc.)
4. Update this README
5. Commit and push
