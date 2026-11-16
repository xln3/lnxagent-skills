# 跨 Agent 会话账本：启动共识与调研结论（draft v0.1）

状态：需求澄清与方案研究阶段。本文是初始框架，不是冻结规格。

版本提示：真实 DSH 样本和体积实验见 [draft v0.2](session-ledger-kickoff-v0.2.md)；当前推荐形态见[宿主内插件与各家原生日志架构（draft v0.3）](session-ledger-plugin-architecture-v0.3.md)。本文保留为 v0.1 初始设计，不再作为当前推荐存储架构。

## 1. 问题定义

用户需要把正在 Codex、Claude Code、DeepSeek Harness 等不同 agent runtime 中运行的任务迁移到另一个环境，并且在迁移、复盘、审计时保留完整上下文。当前对 Markdown 的 `/export` 往往导出的是显示层或压缩后的活动上下文，无法作为原始事实记录。

## 2. 目标

- 从 session 开始持续记录，而不是事后从 UI 反推。
- 记录用户输入、模型可见和不可见的 assistant 输出、reasoning/thinking（能从运行时获得时）、工具调用与结果、文件和命令操作、审批/中断/错误、压缩与恢复边界。
- 递归记录子智能体、孙智能体，并保留父子关系、调用关系和相对路径跳转。
- 用统一的、可扩展的事件格式保存原始记录；Markdown/HTML/JSON/ZIP 是派生视图或交接包。
- 支持跨 runtime 读取已有本地日志，支持在线采集和离线导入两种路径。
- 默认本地优先、可审计、可增量写入，避免单次导出丢失历史。

## 3. 暂定非目标

- 不承诺恢复 runtime 从未暴露给插件/日志的隐藏模型思维链。
- 不把“当前模型上下文”当作完整历史；压缩只记录为一个事件和投影边界。
- 不把敏感内容上传云端作为默认行为。
- “用户在终端外部的操作”先作为可选扩展，不进入首版强制范围。

## 4. 初始架构

1. **采集适配器**：Codex、Claude Code、DeepSeek Harness，各自读取原始 session 文件、hook 或事件流。
2. **规范化层**：把来源事件映射为统一 `LedgerEvent`，保留 `source.raw` 和来源定位，未知字段不丢弃。
3. **追加式账本**：按 NDJSON/JSONL 写入，事件带全局唯一 ID、单调序号、时间、runtime、session、agent、父子关系、类型和内容哈希。
4. **附件仓库**：大工具输出、图片、文件、补丁和命令 stdout 以内容寻址文件保存，事件只引用相对路径和 SHA-256。
5. **投影器**：从原始账本生成 Markdown（阅读）、HTML（树状导航）、JSON（交换）、ZIP（交接包）和搜索索引；任何投影都不能覆盖原始账本。
6. **验证器**：检查事件序列连续性、父子引用、附件哈希、压缩边界、尾部损坏和导出完整性。

## 5. 核心事件草案

`session.started/ended`、`user.message`、`assistant.message`、`assistant.reasoning`、`assistant.attempt`、`tool.call`、`tool.result`、`command.exec`、`file.read/write`、`approval.request/decision`、`agent.spawn/return`、`context.compaction.start/summary/end`、`session.fork/resume`、`error`、`artifact`、`checkpoint`。

每个事件至少包含：

```json
{
  "schema": "agent-ledger/v0",
  "event_id": "evt_…",
  "seq": 1842,
  "time": "2026-11-03T12:34:56.789Z",
  "runtime": {"name": "claude-code", "version": "…"},
  "session_id": "…",
  "agent_id": "root/agent-7/agent-2",
  "parent_agent_id": "root/agent-7",
  "type": "tool.result",
  "payload": {"…": "…"},
  "source": {"path": "sources/claude/…jsonl", "line": 912},
  "content_sha256": "…"
}
```

相对路径从交接包根目录计算，例如 `sessions/root/events.ndjson`、`sessions/root/children/agent-7/events.ndjson`、`artifacts/sha256/ab/cd…`。

## 6. 已检索到的实现

- DeepSeek Harness：事件溯源 Session，原始日志是 append-only；模型历史从事件重新派生，压缩以 surface replacement 保留旧事件。`/export` ZIP 会导出 session、子 session 和附件；Markdown 复制从完整 raw log 生成，但会省略 reasoning、system/developer、runtime 记录等。
- Codex CLI：保存本地 session transcript，并支持 `/export`、`resume`、`fork`；其显示/导出命令不等同于跨 runtime 的无损事件账本。
- Claude Code：本地 JSONL transcript，子智能体有独立 transcript 和递归目录；可通过 hook 获得 `transcript_path`、`agent_transcript_path` 等信息。
- OpenTelemetry GenAI semantic conventions：定义了模型输入/输出、工具调用、工具结果、系统指令、token usage 等字段；适合作为观测互操作的参考，但不是完整交接格式。
- 社区工具：`ai_session_export`、`llm-session-archive`、Claude session explorer、OMP 等已实现多来源解析、HTML/Markdown 导出和递归 sub-session 展示；多数是读取/渲染器，不负责从 session 起点持续采集和不可变原始账本。

## 7. 首轮待验证问题

- 各 runtime 的“原始日志”是否包含完整 reasoning、系统提示、审批和所有工具输出；哪些内容只有 UI 或服务端可见。
- Codex、Claude Code 的当前版本文件格式、保留期限和并发写入行为。
- 子智能体 ID、父子关系、fork/compact lineage 能否稳定跨版本重建。
- 大输出、二进制附件和密钥脱敏的默认策略。
- 交接目标是“另一个 agent 可继续执行”还是“人类可完整复盘”，两者需要不同投影和安全策略。

## 8. 建议的 MVP 验收

给三个 runtime 各准备一个包含多轮对话、工具调用、压缩、失败重试和至少一个子智能体的样本。MVP 必须能：原样导入；重建完整时间线；递归展开子智能体；定位每个事件的来源文件/行号；验证 Markdown/HTML/ZIP 与原始账本一致；在尾部写入中断后继续追加而不重复或丢失。

