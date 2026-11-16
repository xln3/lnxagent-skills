# lnxagent-skills

Custom skills and host plugins for LLM agent operations.

## Skills

| Skill | Command | Description |
|-------|---------|-------------|
| [ssh-bridge](skills/ssh-bridge/) | `/ssh-bridge` | Connect to a remote server through a human's VPN-gated PC as bridge |
| [migrate-server](skills/migrate-server/) | `/migrate-server` | Migrate a running production system to another server (survey → plan → execute → verify) |
| [china-mirrors](skills/china-mirrors/) | `/china-mirrors` | Configure package mirrors for China servers (Docker Hub, PyPI, HuggingFace, NPM) |
| [resilient-remote](skills/resilient-remote/) | `/resilient-remote` | Run long operations through unstable SSH connections (nohup, rsync resume, retry) |
| [wudi-renhua-editor](skills/wudi-renhua-editor/) | `/wudi-renhua-editor` | Rewrite Chinese AI-like or formulaic prose into accurate, concrete, natural language |
| [workflow-diagram](skills/workflow-diagram/) | `/workflow-diagram` | Generate editable draw.io workflows and storyboard animations from business documents or sketches |

## Plugins

| Plugin | Description |
|--------|-------------|
| [dsh-session-handoff](plugins/dsh-session-handoff/) | Experimental DSH host plugin that exports native session logs, complete review views, and continuation handoff packages |

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
| [跨 Agent 会话账本：启动共识（v0.1）](docs/session-ledger-kickoff.md) | 问题定义、目标、初始架构与已有实现调研；已被 v0.3 架构取代，保留作背景 |
| [跨 Agent 会话账本：真实 DSH 样本（v0.2）](docs/session-ledger-kickoff-v0.2.md) | 真实 DSH 日志样本、完整性边界和体积实验 |
| [跨 Agent 会话插件：宿主原生日志架构（v0.3）](docs/session-ledger-plugin-architecture-v0.3.md) | 当前推荐架构：宿主内薄插件 + 各家原生日志 + 共享只读投影，以及 MVP 与验收指标 |
| [跨 Agent 会话插件：DSH 能力审计与纵向实现（v0.4）](docs/session-ledger-implementation-v0.4.md) | DSH 原生接口审计、`/handoff` 首个切片及 Loader 级实测 |
| [跨 Agent 会话插件：DSH 真实运行验收（v0.5）](docs/session-ledger-dsh-acceptance-v0.5.md) | 真实 Web UI、compact、异步子会话、附件与接收 Agent 续跑的端到端验收 |

## Adding New Skills

1. Create a directory under `skills/<skill-name>/`
2. Add `SKILL.md` with frontmatter (see existing skills for format)
3. Add supporting files (diagnostics, safety rules, templates, etc.)
4. Update this README
5. Commit and push
