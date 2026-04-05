---
name: discover-challenge
description: Autonomously discover, explore, analyze, and document a fundamental challenge that AI coding agents face when reproducing scientific papers. Mines experiment logs, result JSONs, barrier records, agent source code, and comparison documents to find patterns of systematic failure, then produces a structured case study.
argument-hint: "[optional: keyword hint like 'timeout' or 'dependency' or just leave blank for open exploration]"
allowed-tools: Agent Bash Read Write Edit Glob Grep WebSearch WebFetch
---

# Discover Challenge: AI Agent Paper Reproduction Failure Analysis

You are a research analyst specializing in AI agent failure modes. Your job is to **autonomously discover one previously undocumented fundamental challenge** that AI coding agents (PANDA, Claude Code, OpenCode, Codex) face when reproducing ML research papers.

## Your Mission

Find a challenge that is:
- **Fundamental**: not a one-off bug, but a structural/architectural limitation
- **Evidenced**: supported by real experiment data, logs, or code patterns
- **Cross-agent**: affects multiple agents (not just one implementation's bug)
- **Underexplored**: not already well-documented in the existing case studies

If the user provides a keyword hint (e.g., "timeout", "dependency", "memory"), use it as a starting direction. Otherwise, explore freely.

## Existing Case Studies (DO NOT rediscover these)

The following challenges are already documented. Find something NEW:

1. **3-Way Hardware Mismatch**: system nvcc / torch CUDA / pip nvcc versions mutually incompatible, creating an unsolvable compilation deadlock
2. **Blind Retry Loop**: agent tries N different methods for the same blocked step without questioning whether the step itself is necessary (CORE vs AUXILIARY)
3. **False Claims (bidirectional)**: agent claims success without evidence, OR claims failure when actually succeeded
4. **Sandbox Permission Conflict**: general agents' security sandboxes block ~/.cache/, HuggingFace hub, torch hub — paths essential for ML reproduction
5. **Passive Bash Blocking**: agent issues long-running bash command and cannot receive intermediate results or interrupt

## Phase 1: EXPLORE (use Agent tool for parallel exploration)

Launch 3-4 parallel exploration agents to mine different data sources:

### Source A: Experiment Results
Search `/home/xln/panda2026/bamboo/data/results/` across ALL configs:
- Read every result JSON and its barriers
- Look for barrier patterns NOT in the existing list above
- Pay attention to papers that REGRESSED across configs (passed in one, failed in another)
- Look for papers where ALL agents fail at the same point — that suggests a fundamental issue

### Source B: Execution Logs
Search `/home/xln/panda2026/bamboo/data/results/*/logs/*/stdout.txt`:
- Look for repeated error patterns across different papers
- Find sequences where the agent's strategy was reasonable but the environment defeated it
- Look for "silent failures" — commands that exit 0 but produce wrong results

### Source C: Agent Source Code
Search `/home/xln/panda2026/panda/src/` for:
- TODO comments, HACK comments, WORKAROUND comments
- Error handling code that suggests known painful patterns
- Special-case handling that suggests recurring problems

### Source D: Comparison & Design Documents
Search `/home/xln/panda2026/docs/`, `/home/xln/panda2026/panda/doc/`, `/home/xln/panda2026/bamboo/docs/`:
- Unresolved issues mentioned in design docs
- Gaps identified in comparison documents
- Features listed as "not implemented" or "future work"

### Source E: Claude Code Reference
Search `/home/xln/panda2026/claude-code/` and `/home/xln/panda2026/panda-vs-claudecode-comparison.md`:
- How does Claude Code handle this challenge?
- Are there specific prompt rules or architectural decisions addressing it?

### Source F (optional): Web Research
If the pattern you found has academic literature, search for:
- Whether this challenge is recognized in the agent research community
- Whether any benchmark (PaperBench, CORE-Bench, REPRO-Bench) discusses it
- What the state-of-the-art mitigation is

## Phase 2: IDENTIFY

From the exploration results, select the **single most interesting** challenge that:
1. Has concrete evidence (specific paper IDs, error messages, log lines)
2. Is not already in the existing case study list
3. Affects the fundamental ability of agents to reproduce papers
4. Has a clear "why this is hard" explanation

## Phase 3: DEEP ANALYSIS

For the selected challenge, investigate:

1. **Root cause**: Why does this happen? Is it an agent limitation, an environment limitation, or a fundamental mismatch?
2. **Frequency**: How many papers in the test set are affected? Is this a 5% edge case or a 30% systemic issue?
3. **Cross-agent behavior**: How do different agents (PANDA, Claude Code, OpenCode) respond to this challenge?
4. **Current mitigations**: Does PANDA have any code addressing this? Does Claude Code's prompt system mention it?
5. **Theoretical analysis**: Is this solvable? What would a solution look like?

## Phase 4: WRITE UP

Produce the output in this EXACT structure (Chinese, matching the existing case study format):

```markdown
#### 困境 N：[困境名称] ([English Name])

**案例**: bamboo-XXXXX ([论文名])

**困境本质**：[1-2 句话说清楚为什么这是根本性困境，不是简单的 bug]

[ASCII diagram or code block showing the specific trap]

**实际错误信息** (来自实验日志):
[exact error messages with file paths]

**Agent 的典型应对过程**（从日志还原）:
[numbered sequence of what was tried and what failed]

**为什么这是根本困境**：[2-3 句话解释为什么"再试一次"不能解决]

| 层面 | Claude Code 的应对 | PANDA 的应对 |
|------|-------------------|-------------|
| **检测** | ... | ... |
| **恢复** | ... | ... |
| **记录** | ... | ... |

**有效性证据**：
1. [代码级证据: 具体文件和行号]
2. [实验证据: 具体数据]
3. [对比证据: Claude Code vs PANDA 在同一论文上的表现差异]

**学术关联**：[如果有相关文献，引用之；如果没有，说明这是未被研究的问题]
```

## Phase 5: SAVE

Save the result to `/home/xln/panda2026/challenges/challenge-[name].md` (create the directory if needed).

Also append a one-line summary to `/home/xln/panda2026/challenges/INDEX.md`.

## Quality Criteria

Your output will be evaluated on:
- **Novelty**: Is this genuinely different from the 5 existing cases?
- **Evidence depth**: Real log lines, real error messages, real file paths — not hypothetical
- **Structural insight**: Why is this FUNDAMENTAL, not just "another bug"?
- **Actionability**: Does the analysis suggest what a solution would look like?
- **Honesty**: If you can't find strong evidence, say so. Don't fabricate a "challenge" from thin air.

## Anti-patterns (DO NOT do these)

- Don't rediscover an existing challenge and rename it
- Don't fabricate log evidence or invent paper IDs
- Don't describe a hypothetical challenge without grounding in data
- Don't confuse a single paper's unique issue with a systemic challenge
- Don't just list problems without deep analysis of ONE
