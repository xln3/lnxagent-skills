# 跨 Agent 会话插件：DSH 真实运行验收（draft v0.5）

状态：DSH 纵向闭环已在真实 DSH 0.2.2-rc.1 Web UI、真实模型、真实 compact、真实异步子会话和真实附件上完成验收；v0.3 第 8 节 MVP 第 7 项关闭。本文承接 [v0.4](session-ledger-implementation-v0.4.md)，记录第 4 轮的实测、修复与剩余边界。其他宿主适配器尚未开始。

## 1. 本轮命题

1. `/handoff` 能否在交互式 DSH Web UI 中出现并执行，而不只是被 Loader 挂载？
2. compact、递归子会话、reasoning 块和附件的**成功路径**是否成立？
3. v0.3 MVP 第 7 项：compact 前的要求仍可回看，子会话可递归打开，一个只拿到交接包的接收 Agent 能读取全部人类要求并继续小任务。

## 2. 实验环境

- DSH：`@deepseek-ai/dsh@0.2.2-rc.1`，npm 安装在临时目录，`dsh web` 与 `dsh headless`。
- 隔离：独立 `DSH_HOME` 和独立工作区，不读写用户的 `~/.dsh`。密钥只写在隔离目录的 `.env`（0600），只通过环境变量传给进程，不出现在命令行、日志或本文中。
- 模型：通过 `dsh-llm-pi-ai` 的自定义 provider 接入 RouterLink（`api: openai-completions`，`baseURL: https://router-link.world3.ai/api/v1`，`compat.thinkingFormat: deepseek`），模型 `deepseek-v4.1-flash`，`agent-default-model.reasoningEffort: high`。未设置 `reasoningEffort` 时请求头不带思考档位，原生日志中没有 reasoning 块。
- 插件加载：`dsh web --patch <provider 补丁> --patch plugins/dsh-session-handoff/cordis.yml --no-open`。`--patch` 必须紧跟子命令，放在 `--no-open` 等应用参数之后会报 `unknown option '--patch'`。
- UI 驱动：Playwright 驱动真实 Web UI（输入框是 Lexical `contenteditable`，附件走页面 `input[type=file]`，会话从侧栏 treeitem 打开）。

## 3. 验收任务

主会话共 4 条直接人类消息，全部经 Web UI 发送：

| seq | 内容 | 目的 |
|---|---|---|
| 8 | 上传附件 `spec.txt`（含口令），要求创建 `data.csv` 并统计；约束 A：产物首行必须是 `# owner: handoff-test`；README 以后再写，最后一行要写附件口令原文 | 附件、reasoning、约束将被 compact 遮蔽 |
| 40 | 必须通过 subagent 工具派子智能体计算平均值并写 `avg.txt` | 真实子会话 |
| 72 | 误发的 `/compact` 纯文本（见 5.1） | 意外输入也必须原样保留 |
| 90 | compact 之后：“写 README.md……这轮先不要执行，只确认收到” | compact 后的新要求与待办 |

中间通过 UI 菜单执行了真实 `/compact`（seq 76–85），然后执行 `/handoff`。

## 4. 实测结果

### 4.1 原生行为

- **附件**：seq 8 的 `user/message` 内容为 `[file, text]`，附件按 `sha256:<digest>` 存入 DSH 附件仓库；模型用 `read` 工具读取了仓库中的副本。
- **reasoning**：主会话 7 个、子会话 3 个 reasoning 块写入原生日志。
- **子会话是异步的**：seq 42 `subagent` 调用返回 `started subagent <id>` 后，父 turn 立即结束；子会话完成后通过 `agent/inbox/spliced`、`agent-message` 和 `subagent-settled` 注入父会话，开启新的 turn 让父 Agent 核对结果。子会话 id 是裸 UUID，没有 `session-` 前缀；它的 header 带 `parentSession` 和 `origin: subagent`，父会话中有 `subagent/catalog` 记录 `childId`。
- **compact**：`compaction/start` → `compaction/summary` → `user/message`（`source.kind=compact-checkpoint`，`surfaceOp: {op: replace, startSeq: 8, endSeq: 72}`）→ `compaction/end`。当前 surface 从此只含 seq 7、83、73 以及 compact 后的新事件。

### 4.2 `/handoff` 交接包

在 UI 中执行了三次：v1 无参数（默认 `<cwd>/.dsh-handoff/<session-id>`），v2、v3 带绝对路径参数。三次都成功，每次 2 个会话、8 个文件。

独立校验脚本按 DSH 源日志、原始附件逐项比对（v3 共 38 项全部通过）：

1. manifest 恰好列出包内全部文件，每个文件的字节数和 SHA-256 复核一致。
2. 主会话 105 条、子会话 51 条导出事件，与隔离 `DSH_HOME` 中 `.jsonl.zstd` 解压后的 header 和事件前缀逐条 JSON 相等；seq 连续。
3. 4 条直接人类要求（含 compact 前的 seq 8、40、72）全部逐字出现在 `handoff.md`；子会话的任务说明逐字出现在子会话 `handoff.md`。
4. `review.md` 含全部事件和全部 reasoning 块，含 `compaction/summary`；`handoff.md` 的当前 surface 不含被替换的 seq 8–72。
5. 父会话 `subagent/catalog` 中的子会话集合 = manifest 中 `parentSession` 指向根的会话集合；子会话日志和视图位于 `native/subagents/<id>/` 与 `views/subagents/<id>/`。
6. 附件副本 `artifacts/files/00/<digest>/spec.txt` 的 SHA-256 与原始输入文件一致，也与原生日志中的 `attachmentId` 一致。
7. 用 python-markdown 实际渲染全部视图后，每个 `<a href>` 都能在包内解析到文件。

### 4.3 接收 Agent

两个全新的 `dsh headless` 会话，各自在新目录中只拿到“迁移过来的 `data.csv`、`avg.txt` + 交接包”，提示词只说明交接包位置和“完成未完成的任务、不要重做已完成步骤”，不复述任务内容。

| 运行 | 交接包 | 结果 |
|---|---|---|
| recv1 | v1（修复前） | 写出 `README.md`：首行 `# owner: handoff-test`，末行为口令原文；`data.csv`、`avg.txt` md5 不变；口令取自包内 `spec.txt`（先 `find` 全包才找到） |
| recv2 | v3（修复后） | 同样通过；从 `handoff.md`、`manifest.json` 直接打开包内 `spec.txt`，没有全包搜索 |

两个接收 Agent 都识别出 seq 72 的 `/compact` 不是任务，seq 90 是唯一待办；原工作区没有被写入。

### 4.4 零双写

运行期间隔离 `DSH_HOME` 中没有插件写入的文件（`storages/session_projcache` 是 DSH 自身缓存）；正文只出现在用户显式指定的导出目录中。

## 5. 本轮发现与修复

### 5.1 宿主 / 驱动层观察（非插件缺陷）

- 在输入框键入 `/compact` 后直接回车，消息作为普通用户文本发出（seq 72），模型回复“没有这个命令”；从命令菜单点选才会执行命令。无参数命令（`compact`）点选即执行；带输入提示的命令（`handoff [new output directory]`）点选后先填入输入框，需要再回车。该现象出自 Playwright 驱动，未用人工键盘复现。
- 命令执行期间关闭页面，`compaction/end` 记录 `error: "Request was aborted"`；命令生命周期绑定在 Web 客户端连接上。
- 未发送的输入框草稿会被保留，多次自动化失败后叠成 `/handoff/handoff/…`；驱动需先清空输入框。
- recv1 的 stdout 末尾混入了模型的规划文字，属于 provider/宿主输出边界问题，与交接包无关。

### 5.2 插件缺陷（已修复）

1. **工作目录渲染破坏整份 Markdown。** `- Working directory:` 后直接接多行代码围栏，后面那个独占一行的 ```` ``` ```` 打开了一个不闭合的围栏，其后全部内容（含子会话链接）在真实渲染器中变成代码；v1 渲染后可点击链接为 0。改为按内容长度选择反引号的行内代码。
2. **附件只有原始 JSON，没有包内位置。** 新增按 DSH 实际写出的 artifact 条目反查 `attachmentId` → 包内相对路径，在 file/image 块下输出 `Package copy: [...]`；未导出时明确写 `(not exported)`。
3. **`review.md` 没有子会话链接。** 复盘视图也加入 Descendant sessions 小节，递归导航不再依赖 `handoff.md`。

修复后重新构建、重启宿主、在 UI 中重新导出 v3，并重跑校验和接收 Agent。

## 6. 仍未关闭

- 仅在 DSH 0.2.2-rc.1、JSONL persistence 后端、单层子会话上验收；孙会话、fork、resume 的成功路径未用真实样本验证（递归实现按 `traceSession` 的子树结构编写）。
- `handoff.md` 在 105 条事件时约 113 KB：当前 surface 中的系统提示、skill catalog 和逐行展开的 `stream` 数组占了大部分篇幅。内容完整但噪声大，接收 Agent 两次都能处理；更大的会话需要折叠策略，且不能删减人类要求原文。
- 子会话视图没有指回父会话的链接。
- 工作区状态仍不在交接包中（`workspaceAndExternalState: not-captured`）；本轮由验收者手工迁移 `data.csv`、`avg.txt`。
- 物理 `.zstd` 文件与导出 JSONL 的字节一致性仍不承诺；本轮比较的是解压后的逻辑事件。

## 7. 第 4 轮变更记录

- `round`: 4
- `document_version`: draft v0.5
- `experiment_batch`: `dsh-real-ui-acceptance-20261111-01`
- `trigger`: 用户要求接手前一会话，完成实现和真实运行验收。
- `document_changes`: 新增本文；v0.3、v0.4 状态行指向本文；插件 README 更新状态、加载命令与 UI 用法。
- `experiment_changes`: 从 Loader 级验证升级为真实 Web UI + 真实模型的端到端任务；新增独立包校验脚本、渲染级链接检查和两个 headless 接收 Agent。
- `expected_effect`: 关闭 v0.4 遗留的 UI 验收和复杂样本缺口，并以接收 Agent 能否续跑作为 MVP 第 7 项的判据。
- `observed_result`: UI 执行、compact、异步子会话、reasoning、附件、递归导出、来源一致性和接收续跑均通过；发现并修复 3 个视图缺陷，修复后复测通过。
- `decision`: DSH 纵向闭环视为完成，作为其他宿主适配的参照实现；下一步先对 Claude Code、Codex、Kimi Code 逐个做扩展点能力审计，同时把 `handoff.md` 噪声折叠和工作区显式收集列为 DSH 侧后续项。
