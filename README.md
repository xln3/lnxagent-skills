# lnxagent-skills

Custom Claude Code skills for LLM agent operations.

## Skills

| Skill | Command | Description |
|-------|---------|-------------|
| [ssh-bridge](skills/ssh-bridge/) | `/ssh-bridge` | Connect to a remote server through a human's VPN-gated PC as bridge |

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

## Adding New Skills

1. Create a directory under `skills/<skill-name>/`
2. Add `SKILL.md` with frontmatter (see existing skills for format)
3. Add supporting files (diagnostics, safety rules, templates, etc.)
4. Update this README
5. Commit and push
