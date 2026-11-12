# 跨 Agent 会话账本：真实 DSH 样本与低冗余方案（draft v0.2）

状态：研究第 1 轮完成，方案仍未冻结。本文保留 v0.1 的目标，依据本机真实 DSH 日志和官方契约修订存储架构；不是实现完成报告。

架构更新：用户已在第 2 轮拍板采用[宿主内插件与各家原生日志架构（draft v0.3）](session-ledger-plugin-architecture-v0.3.md)。本文的真实样本和体积实验仍有效，但第 5 节的原生镜像/直接采集方案与第 8 节 MVP 已被 v0.3 替代。

## 1. 本轮回答的问题

1. 一个真实 DeepSeek Harness（DSH）会话到底记录了什么？
2. compact 后，原始要求、回复和工具事件是否仍可从原始日志重建？
3. 子智能体、附件和失败尝试是否有可交接的记录？
4. v0.1 的“统一事件正文 + `source.raw` 完整原文”会造成多少体积开销？
5. 能否既保留原始事实，又避免把同一份内容存两三遍？

## 2. 真实样本与可复核入口

主样本是本机一次真实 DSH smoke 会话，不是按文档虚构的 fixture：

```text
/home/xln/.dsh/sessions/--tmp-dsh-deepseek-smoke-20261014--/session-50fa4174-30d1-4900-bf23-01502dc55fe2/session.v4.jsonl.zstd
```

- 逻辑格式：Session V4。这里的 V4 不是 DSH Harness 软件版本；本机 `dsh` 不在 PATH，本轮未确认安装包版本。
- 原始文件：18,118 B，10 个独立带校验的 Zstandard frame。
- SHA-256：`ae15de7272b121ccfb1da176fa9331e67cc65e9951b7177a0843c44bd157ddb1`。
- 解压后：55,891 B，25 条 JSONL 记录。
- 会话内容：1 个 turn、2 个 step、1 次真实 bash 工具调用、2 条 assistant/message。
- 用户要求：调用 bash 执行 `printf TOOL_OK`，然后只回复 `TOOL_OK`。
- 实际结果：工具返回 `TOOL_OK`，最终助手回复 `TOOL_OK`，turn 正常完成。

直接查看完整原始记录：

```bash
zstd -dc /home/xln/.dsh/sessions/--tmp-dsh-deepseek-smoke-20261014--/session-50fa4174-30d1-4900-bf23-01502dc55fe2/session.v4.jsonl.zstd | nl -ba
```

本轮还只读统计了本机其余 7 份 DSH 日志。8 份全部是 `delegationDepth=0` 的单轮根会话，没有本地 compact 或子会话样本。因此，compact 和子会话的结论必须区分为“官方契约证据”，不能伪装成本机实录。

### 2.1 原始事件摘录

以下是主样本的原始第 10、19、20 行；JSON 内容未做语义改写：

```jsonl
{"type":"user/message","seq":8,"time":1791945979669,"data":{"content":[{"type":"text","text":"请调用 bash 执行 printf TOOL_OK，然后只回复 TOOL_OK"}],"source":{"kind":"user"},"role":"user","id":"82b90448-daa1-46fb-8a56-b37a43b30941"},"surfaceOp":"append"}
{"type":"tool/call","seq":17,"time":1791945981164,"data":{"turn":1,"step":1,"callId":"call_00_InGsRRhJfAUepbFkyXHR1152","name":"bash","arguments":"{\"command\":\"printf TOOL_OK\",\"description\":\"Print TOOL_OK\"}"}}
{"type":"tool/result","seq":18,"time":1791945981258,"data":{"turn":1,"step":1,"message":{"role":"tool","source":{"kind":"tool","callId":"call_00_InGsRRhJfAUepbFkyXHR1152"},"toolCallId":"call_00_InGsRRhJfAUepbFkyXHR1152","content":[{"type":"text","text":"TOOL_OK"}],"isError":false,"id":"9591280e-adfe-4bf1-b540-b943699157ea"}},"sourceEventSeqs":[17],"surfaceOp":"append"}
```

第 18 行是产生工具调用的 `assistant/message`。除最终 `message.content` 外，它还保存：

- provider、model、responseId、stopReason 和 replayState；
- input/output/total/cache token 用量；
- 5 个流式记录，包括 block-start、工具参数分片、block-end、usage 和 finish；
- 工具调用 ID、函数名和参数。

第 23 行是最终 `TOOL_OK` 回答，也同时保存最终文本、文本流式分片、token 用量和 finish。也就是说，DSH 原始日志不是只保存 UI 最终文本；它保存了已提交模型响应的重放信息。

### 2.2 失败尝试也有实录

另一份真实 smoke 日志：

```text
/home/xln/.dsh/sessions/--tmp-dsh-smoke--/session-720d57b6-0eff-4d8e-b81a-a2283884efe0/session.v4.jsonl.zstd
```

其原始第 17 行是 `assistant/attempt`，而不是进入模型历史的 `assistant/message`。流末尾记录了 `finish.reason.kind=error`、HTTP 401 和 `AUTH`，API key 已掩码为 `****test`。这证明失败模型尝试可以独立于正常回答保留。

## 3. 完整性判断

| 内容 | 本轮证据 | 判断与边界 |
|---|---|---|
| 人类要求原文 | 主样本第 10 行 | 已本机实测；与 runtime-context、skill-catalog 等 user-role 注入分开标记来源 |
| 助手最终回复 | 第 18、23 行 | 已本机实测 |
| 助手流式输出与重放信息 | 两条 assistant/message 的 `stream` | 已本机实测；只保证已提交内容 |
| 工具名称、参数、结果、错误标记 | 第 19、20 行 | 已本机实测；可通过 callId 对齐 |
| 系统提示、运行时上下文、技能目录、工具 schema | 第 9、11、12、13 行 | 已本机实测；这些静态内容占据大部分体积 |
| 失败、取消、重试 | 另一样本的 401 `assistant/attempt`；官方事件契约 | 失败已实测；取消和重试未在这份主样本覆盖 |
| compact | 官方 compaction 契约 | `compaction/start/summary/end` 全是 log-only；摘要通过追加一个 `user/message`，以 `surfaceOp.replace` 遮蔽当前 surface 中的旧节点，旧原始事件不删除 |
| 子智能体与递归导出 | 官方 V4 和 export 契约 | V4 header 有 `parentSession`、`origin=subagent`、`delegationDepth`；`subagent/catalog` 记录子会话；ZIP 包含后代日志和附件。本地未实测 |
| 附件 | 官方 export 契约 | ZIP 收集消息和已完成流块中声明的附件；本地样本无附件 |
| reasoning/thinking | 原始消息/流支持相应块，Markdown export 明确省略 reasoning | 本地样本没有 reasoning 块；绝不承诺获取 provider 未暴露的隐藏思维链 |
| 崩溃尾部 | 官方 persistence 契约 | 已提交前缀保留；撕裂尾帧按恢复规则处理；进程硬退出前尚未 settle 的尝试没有完整持久化保证 |
| 工作区和外部副作用 | 不在 session log 的完整性承诺内 | 文件当前状态、未提交改动、后台进程、外部服务状态必须另行交接，不能从工具历史假装恢复 |

官方 Session 文档的关键承诺是“model-visible means logged”：模型请求需要能从日志重建。官方也同时明确：硬进程丢失前未 settle 的 attempt stream 不在持久保证内。

因此，DSH 原始日志足以作为**已提交会话历史的权威事实源**，但“另一个 Agent 完整接手”必须拆成三级：

1. **完整复盘**：保留全部已提交原始事件、附件和父子引用，可以重建历史。
2. **语义交接**：把全部人类要求、当前有效上下文、未完成工具状态和必要工作区状态交给另一个 Agent，使其继续任务。
3. **原生恢复**：恢复原 runtime 的精确请求、运行任务和内部状态。跨 runtime 不承诺这一级；同 runtime 也受格式版本、provider 和持久化完整性约束。

## 4. 体积实验

实验输入只有第 2 节的真实主样本。对照如下：

- **原生 JSONL**：解压后的 25 行原始记录。
- **v0.1 正文存一次**：把 `data` 映射到统一 `payload`，增加统一信封、来源定位和哈希，不再附原事件。
- **v0.1 正文 + `source.raw`**：统一 `payload` 和完整原事件同时保存。
- **原生日志 + 薄索引**：原生压缩文件逐字节保留，另存事件类型、序号和原始行号，不复制正文。
- **阅读投影**：只抽取人类要求、助手内容、工具调用和结果；它是派生视图，不是归档替代品。

| 方案 | 明文字节 | Zstandard 字节 | 相对原生 18,118 B |
|---|---:|---:|---:|
| 原生 DSH 多帧文件 | 55,891 | 18,118 | 1.00× |
| 原生 JSONL 整批重压缩 | 55,891 | 16,707 | 0.92× |
| v0.1 正文存一次 | 63,544 | 18,290 | 1.01× |
| v0.1 正文 + `source.raw` | 119,392 | 18,805 | 1.04× |
| 原生 DSH 文件 + 341 B 薄索引 | 57,081 | 18,459 | 1.02× |
| 阅读投影 alone（非归档） | 703 | 335 | 0.02× |

说明：前四种规范化对照采用同一 zstd CLI 整批压缩；与原生多帧文件比较用于量级判断，不是相同写入器的性能基准。薄索引和原文件分别压缩后直接相加。

### 4.1 结论不是“无损一定非常占盘”

v0.1 的双份正文使明文增加到 2.14 倍，但整批压缩后只比原生文件多约 3.7%。精确重复内容很容易被 Zstandard 压缩。双份正文的主要代价是内存、解析、写入放大和格式复杂度，不是同比例的磁盘增长。

尽管如此，`source.raw` 仍应删除：它没有带来事实增益，而“原生文件 + 薄索引”更小、更简单，还能逐字节验证来源。

### 4.2 批量压缩比重复删除更影响磁盘

对“正文 + `source.raw`”方案按不同批次分别压缩：

| 每批事件数 | 总压缩字节 |
|---:|---:|
| 1 | 24,384 |
| 4 | 20,453 |
| 8 | 19,415 |
| 24（全部） | 18,805 |

因此，新方案必须按追加批次压缩，不能把每个事件单独压缩成一个独立文件。DSH 自身也是“一个 header frame + 每个 durable append batch 一个 frame”。

### 4.3 大头不是人类对话

主样本明文字节分布：

- `user/message`：27,568 B（49.3%），其中大部分是 runtime-context 和 skill-catalog，不是人类输入；
- `request/header`：18,720 B（33.5%），主要是工具 schema；
- `assistant/message`：3,316 B（5.9%），其中流式表示分别为 1,284 B 和 862 B；
- 人类要求、助手输出、工具调用与结果的阅读投影：703 B。

所以不应通过丢弃旧对话来省空间。优先策略是：静态原文只存一次、整批压缩、派生视图按需生成、附件去重。

## 5. 修订后的架构：统一索引，原始正文只存一次

### 5.1 两种采集模式

**A. 原生镜像模式（有可靠原生日志时，优先）**

- 原生日志是唯一正文事实源，保留其原始压缩和帧边界。
- 增量跟随文件，只复制完整 frame 或完整行；记录来源 revision、offset、frame/line 和校验。
- 统一层只写薄索引与标准化事件类型，不保存 `payload`，绝不保存 `source.raw`。
- 阅读、搜索和交接时通过来源适配器按需解码。

适用于 DSH，以及经实测满足追加和完整性要求的 Codex/Claude Code 原生日志。

**B. 直接采集模式（只有 hook/事件流，或原生日志缺字段时）**

- 统一事件的 `payload` 内联保存一次。
- 未知字段放在扩展 payload 中保留，不再额外复制整份 raw event。
- 按 durable append batch 写 NDJSON + Zstandard frame。
- 来源 runtime 没暴露的内容标记为 `unavailable`，不补造。

两种模式可以共存，但同一份内容只能指定一个权威载体，避免双写事实源。

### 5.2 薄索引不是第二份完整账本

建议索引行：

```json
{
  "schema": "agent-ledger-index/v0",
  "seq": 17,
  "time": 1791945981164,
  "kind": "tool.call",
  "source": {"file": "sources/dsh/root/session.v4.jsonl.zstd", "line": 19},
  "links": {"call_id": "call_00_InGsRRhJfAUepbFkyXHR1152"}
}
```

- runtime、session、agent 和 adapter 版本放在 manifest，不在每行重复。
- `(session_id, seq)` 已能确定事件时，不另存冗长 event_id；需要时可确定性派生。
- `kind` 是统一分类；原始 `type` 和全部 payload 仍可从 source 精确恢复。
- 文件级和 frame 级校验放在 manifest/checkpoint，不给每条事件重复写 64 字符哈希。
- SQLite、全文索引和 HTML 都是可删除、可重建的缓存，不是事实源。

### 5.3 推荐包布局

```text
handoff-package/
  manifest.json
  sources/
    dsh/root/session.v4.jsonl.zstd
    dsh/children/<child-id>/session.v4.jsonl.zstd
  index/
    root.events.ndjson.zstd
    children/<child-id>.events.ndjson.zstd
  artifacts/
    sha256/...                  # 只放原生记录未包含的附件或外部产物
  views/
    review.md                   # 完整阅读投影，可重新生成
    handoff.md                  # 续跑投影，可重新生成
  workspace/                    # 仅当任务续跑需要时显式收集
    git-status.txt
    changes.patch
    manifest.json
```

默认归档只需 `manifest + sources + index + 必要附件`。`review.md`、HTML、ZIP 和搜索缓存按需生成，避免派生物长期占用第二份空间。

### 5.4 compact 的处理原则

- 原始事件永远不因为 compact 被删除。
- 索引同时记录 `append` 与 `replace` 的边界和来源关系。
- `review.md` 读取全部已提交 append 历史，compact 后仍能回看旧要求。
- 续跑上下文读取当前 surface，不把已经遮蔽的旧消息误当成仍发送给模型的内容。
- 交接包必须能分别回答“历史上发生过什么”和“当前模型实际看到什么”。

## 6. 跨 Agent 交接视图

`handoff.md` 不能只给一份压缩摘要。至少包含：

1. **全部人类要求原文**，按轮次排列，不省略早期补充和修改。
2. **当前有效上下文**，含 compact checkpoint 和当前 surface 范围。
3. **未完成任务和显式待办**，区分用户要求与 Agent 自己提出的计划。
4. **工具与副作用状态**，尤其未完成、失败、结果未知和需要审批的调用。
5. **子智能体链接**，用相对路径指向各自完整日志、索引和交接视图。
6. **工作区状态**，在续跑需要时提供 VCS revision、diff、未跟踪文件清单和产物引用。
7. **覆盖与缺口**，明确未捕获的 reasoning、未 settle 的流、缺失附件和外部状态。
8. **原始来源定位**，让接收 Agent 能继续翻查完整历史，而不是只能相信摘要。

如果目标模型上下文放不下全部正文，必须显式写出已纳入的 seq 范围和可分页来源；不能静默截断后仍称为“完整交接”。

## 7. 安全和耐久边界

- 默认本地处理；原始日志可能包含密钥、个人数据和内部路径，上传或外发前必须单独审查。
- 脱敏视图可以从原始包生成，但不能用脱敏投影覆盖原始事实源。
- 镜像正在增长的文件时，只承认完整提交边界；记录 source revision，防止把 torn tail 当成事实。
- 冻结导出后验证源文件哈希、frame/行数、事件 seq、父子链接和附件哈希。
- 不把后台进程、浏览器登录态或外部服务“仍在运行”当作会话日志已证明的事实。

## 8. 修订后的 MVP 与验收门

先做 DSH 纵向闭环，再复制到 Codex/Kimi Code/Claude Code，避免同时编写三个适配器却没有可验证的交接语义。

### 8.1 第一阶段：DSH 完整读取与低冗余归档

- 读取多帧 V4 Zstandard JSONL，校验 header、seq 和 source hash。
- 生成薄索引；原生压缩文件逐字节保留。
- 生成完整 `review.md` 和当前 surface 的 `handoff.md`。
- 递归收集后代会话和附件；缺任何后代必须显式报错，不得静默省略。
- 归档存储开销目标：不含派生视图和新增附件时，不超过原生来源的 5%。本样本的薄索引模拟值为约 1.9%，但实现尚未验收。

### 8.2 第二阶段：真实复杂样本

当前本机样本不够，必须再获得包含以下内容的受控真实 DSH 会话：

- 多轮人类要求及要求变更；
- 成功、失败、重试、取消和结果未知的工具调用；
- 至少一次 compact，compact 后仍能检索 compact 前的原文；
- 至少一个子智能体和一个后代返回值；
- provider 实际暴露的 reasoning（若测试 provider 不提供，则记为不可用，不造样本）；
- 文本和二进制附件。

外部前置条件未满足前，这些项目保持“未验证”，不得进入已实现结论。

### 8.3 第三阶段：跨 runtime 续跑

先选一个接收端做真实续跑，再实现其他目标。验收不是“成功 import”，而是：

- 接收 Agent 能逐字回答早期人类要求，全部人类消息覆盖率 100%；
- 当前 surface 与 DSH 对同一日志的派生结果一致；
- 不错误重放已完成工具，不盲目重试结果未知的有副作用工具；
- 能通过相对路径打开任一子会话和原始事件；
- 能继续一个真实小任务，并保留新旧会话之间的 lineage；
- 明确报告不能原生恢复的运行时状态。

## 9. 本轮变更记录

- `round`: 1
- `document_version`: draft v0.2（v0.1 保留在 `session-ledger-kickoff.md`）
- `experiment_batch`: `dsh-local-20261103-01`
- `trigger`: 用户要求查看真实 DSH 会话，并指出完整账本可能过于庞大。
- `document_changes`: 增加真实事件摘录、完整性边界和体积实验；删除 `source.raw` 双份正文设计；把完整复盘、语义交接和原生恢复拆成三级；MVP 改为 DSH 纵向闭环优先。
- `experiment_changes`: 从格式设想转为读取 8 份本机日志，并对 1 份成功工具会话做事件级和压缩级测量，另核对 1 份失败尝试。
- `expected_effect`: 在保留全部已提交事实的前提下，降低冗余和派生物存储，避免把 Markdown 或 compact 摘要当作唯一交接事实。
- `observed_result`: 原生日志包含最终消息、流、工具、请求信息和失败尝试；双份正文明文为 2.14×，整批压缩仅约 1.04×；薄索引压缩后 341 B；本地尚无 compact/子会话/reasoning/附件实录。
- `decision`: 采用“原生正文一次 + 统一薄索引 + 按需投影”；无原生日志时采用统一 payload 单份直采；不承诺隐藏思维链、未 settle 流或跨 runtime 原生状态恢复。

## 10. 官方依据

- [DSH Session：事件溯源、surface replacement、请求重建和持久化边界](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/session/README.md)
- [DSH Compaction：`compaction/*` 事件与摘要替换语义](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/compaction.md)
- [DSH JSONL Persistence：多帧 Zstandard、追加批次和崩溃恢复](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/session/session-persistence-jsonl/README.md)
- [DSH Session V4：header、父子关系、原生事件和校验](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/session/session-format-v3-to-v4/README.md)
- [DSH Session Log Export：完整 Markdown 投影、递归 ZIP 和附件](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/session-query/session-log-export/README.md)
