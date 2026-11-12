# 跨 Agent 会话插件：DSH 能力审计与首个纵向实现（draft v0.4）

状态：首个纵向切片已在 Loader 与真实原生服务层验证，项目仍未冻结。本文保留 v0.3 的“宿主内插件 + 各家原生日志”决定，依据 DSH 官方当前接口修正适配器与导出口径；交互式 UI 与真实复杂样本的验收及其中发现的视图修复见 [draft v0.5](session-ledger-dsh-acceptance-v0.5.md)；本文第 7 节“仍未关闭”中的前两项已由 v0.5 关闭。

## 1. 本轮命题

1. DSH 外部插件能否不扫描 `~/.dsh`，而从当前命令直接定位并读取活动会话？
2. 能否复用 DSH 原生 Session Query、Persistence 和导出实现，而不自写 Zstandard 解析器或平行账本？
3. 能否生成一个可移动的交接目录，包含完整复盘、当前 surface、全部人类要求、递归子会话和原生附件？
4. v0.3 的“导出文件与物理来源哈希一致”是否是 DSH 原生抽象能够保证的属性？

## 2. 已核实的原生能力

- `ctx.commands.register()` 的 `CommandInvocation` 直接提供 `agent`、`agent.session`、`rawInput` 和取消信号。当前会话入口是 `invocation.agent.session.id`，不是设想中的全局 `activeSession()`。
- `ctx.sessionQuery.readSession(id)` 返回 live 优先、经过重放校验的完整逻辑事件；`readSurface(id)` 返回当前模型 surface；`traceSession(id)` 返回祖先与递归后代。
- `ctx.sessions.flush(session)` 是活动 Session 的持久化屏障。
- `sessionPersistence.open(id, 'read')` 提供只读句柄，已处理持久化格式、有效前缀和撕裂尾部。
- 官方 `dsh-session-log-export` 已提供 `flushLiveSessionLog`、`readSessionLogText`、`sessionLogZipEntries` 和 `serializeSessionLog`，可以递归读取后代并收集附件。
- 官方 `formatSessionMarkdown` 不是本项目的完整复盘视图：它明确省略 reasoning、system/developer、非人类 user-role 注入、request header/context 和运行时记录，因此只能复用底层导出原语，不能把官方 Markdown 当作完整交付。

官方依据：

- [Commands](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/interaction/commands/README.md)
- [Session Query](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/session-query/session-query/README.md)
- [Session Persistence](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/session/session-persistence/README.md)
- [Session Log Export](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/session-query/session-log-export/README.md)

## 3. 对 v0.3 的两处修正

### 3.1 适配器以原生查询服务为中心

DSH 适配器不直接假设物理文件路径，也不自行解析 `.jsonl.zstd`。运行期读取顺序为：

```text
/handoff
  → invocation.agent.session.id
  → sessionQuery.readSession / readSurface / traceSession
  → 共享确定性投影
```

只有原生 JSONL 后端的物理快照才需要知道具体路径；那不是所有 persistence 后端共有的能力。

### 3.2 逻辑原生日志不等于物理文件副本

DSH 官方导出会把后端中的逻辑 Session 规范化为原生 JSONL，供 ZIP 使用；它不保证导出文本与某个 `.zstd` 物理文件逐字节一致，也不保证所有后端都有单一文件。

因此验收拆成：

- **首版必须保证**：逻辑事件来自原生查询/持久化接口；导出的是 DSH 原生 JSONL；manifest 记录导出内容哈希、Session 版本、事件数和覆盖缺口。
- **首版不宣称**：跨后端物理文件字节一致。该属性只能在特定后端、flush 后、文件未被继续追加的一致快照中单独验证。

## 4. 本轮交付物

新增一个独立 DSH 插件包，提供 `/handoff [输出目录]`：

```text
handoff-package/
  manifest.json
  native/
    session.vN.jsonl
    subagents/<session-id>/session.vN.jsonl
  artifacts/
    media/...
    files/...
  views/
    review.md
    handoff.md
    subagents/<session-id>/review.md
    subagents/<session-id>/handoff.md
```

- `review.md`：按 seq 展示全部已提交事件；已知事件给可读摘要，每个事件保留完整原生 JSON，避免视图层静默丢字段。
- `handoff.md`：包含全部 `source.kind=user` 的人类要求原文、当前 surface、未闭环工具调用、compact/lineage 信息、子会话相对链接和覆盖边界。
- `manifest.json`：记录逻辑来源、原生文件与附件哈希、事件计数、递归关系、适配器版本和未覆盖能力。
- 运行期不写第二份正文；只有用户显式执行 `/handoff` 时才生成交接目录。

## 5. 明确不做

- 不实现 Codex、Kimi Code、Claude Code 适配器。
- 不伪造隐藏 reasoning、未 settle 流、外部进程或工作区副作用状态。
- 不自动执行工具、重试结果未知的调用或恢复另一个 runtime 的原生会话。
- 不默认收集整个工作区，不上传交接包，不做云端脱敏。
- 不用 AI 摘要替代全部人类要求原文。

## 6. 验收与停止条件

本轮必须完成：

1. TypeScript 构建通过，插件导出形状符合 Cordis。
2. 通过真实 Cordis Loader 挂载命令，而不是只 import 纯函数。
3. 用真实 DSH Session 服务读取本机 smoke 会话，生成上述目录。
4. 校验全部人类要求逐字存在、原始事件数一致、当前 surface 与原生查询一致、原生 JSONL 可重新解析、manifest 哈希正确、子会话/附件缺失会显式报错。
5. 检查插件数据目录没有运行期正文副本；只有显式导出目录包含正文。

本机没有可用的 `dsh` 可执行入口时，不宣称已在交互式 DSH UI 中点击验收；Loader + 真实原生服务验证与最终 UI 验收分开记录。

## 7. 实测结果

实现位于 `plugins/dsh-session-handoff/`，目标 API 为 DSH `0.2.2-rc.1`。

已通过的检查：

1. `pnpm install`、`pnpm build` 和 `pnpm pack --dry-run`；打包清单包含插件入口、投影、导出器、`cordis.yml` 和 README。
2. 通过真实 Cordis Loader 挂载 `dsh-session`、JSONL persistence、Session Query、Commands 和本插件，找到并执行 `/handoff` handler。
3. 真实成功 smoke 会话：24 条事件加 1 行 header，当前 surface 7 条事件；生成 1 份原生 JSONL、2 份视图和 1 份 manifest。全部人类要求逐字存在，全部事件与 surface 的完整 JSON 存在，manifest 中每个文件的字节数和 SHA-256 复核一致，原生 JSONL 可由 DSH `Session.create` 重放。
4. 真实失败 smoke 会话：18 条事件；`assistant/attempt`、HTTP 401、`AUTH` 和已掩码的 key 均保留在复盘中。
5. 同一冷会话、同一代码的两次独立导出经递归 `diff` 检查，所有文件逐字节一致。
6. 负向验收：已有目标目录不覆盖；缺失后代失败；导出期间并发追加失败；附件读取失败并清理临时目录。
7. 工具状态补测：assistant 已请求但没有 `tool/call` 的调用明确显示为“未记录为开始”，不会与“已开始但结果未知”混为一谈。
8. 原生一致性：header、事件前缀和 surface seq 均校验；冷日志恢复尾部只接受与 DSH 原生 `interruptedTurnClosers` 完全一致的事件。

仍未关闭：

- 本机没有 `dsh` 可执行入口，未在交互式 DSH UI 中点击验收。
- 本机真实样本没有 compact、子会话、reasoning 块或附件；这些成功路径仍待真实复杂样本。递归与附件的失败路径已测，不能据此宣称成功路径已验收。
- 官方附件枚举不覆盖未知事件 payload 中的附件引用；manifest 已明确标记。
- 物理 `.zstd` 文件与导出 JSONL 的字节一致性不在本切片承诺内。

## 8. 第 3 轮变更记录

- `round`: 3
- `document_version`: draft v0.4
- `experiment_batch`: `dsh-capability-and-vertical-slice-20261106-01`
- `trigger`: 用户要求继续审视并推进插件项目。
- `document_changes`: 用真实 Commands/Session Query/Persistence 接口替换抽象猜测；区分逻辑原生日志与物理文件副本；确定并完成 `/handoff` 纵向切片；增加并发一致性、恢复事件和工具未开始状态。
- `experiment_changes`: 从文档设想转为官方接口审计、真实 Loader 挂载、两份真实 Session 导出、确定性复导、四类负向用例和打包检查。
- `expected_effect`: 在保持零运行期正文双写的前提下，得到可实际生成和复核的 DSH 交接包。
- `observed_result`: 构建、Loader、真实读取、完整视图、原生重放、哈希、失败清理和确定性复导均通过；交互式 UI 与真实复杂样本仍未验收。
- `decision`: 将该切片作为后续复杂样本与 UI 验收基线；在这些缺口关闭前，不扩展 Codex、Kimi Code 或 Claude Code 适配器，也不宣称整个 DSH MVP 已冻结。
