# DSH Session Handoff

一个宿主内 DSH 插件：显式执行 `/handoff` 时，直接通过 DSH 原生 Session Query、Persistence 和 Attachment 服务导出会话复盘与续跑交接包。插件没有后台采集器，也不在运行期间写第二份对话正文。

当前状态：已在真实 DSH 0.2.2-rc.1 Web UI 中验收，覆盖真实 compact、异步子会话、reasoning、附件，以及只拿到交接包的接收 Agent 续跑。验收记录见 [draft v0.5](../../docs/session-ledger-dsh-acceptance-v0.5.md)。

## 环境与构建

- Node.js `^22.19.0 || >=24.0.0`
- DSH API `0.2.2-rc.1`

```bash
cd plugins/dsh-session-handoff
pnpm install
pnpm build
```

## 加载

在目标 DSH 0.2.2-rc.1 宿主中使用插件补丁：

```bash
dsh web --patch "$PWD/cordis.yml" --no-open
```

`--patch` 要紧跟子命令，放在 `--no-open` 等应用参数前面；可以重复传入多个补丁（例如再加一个模型 provider 补丁）。也可以把 `cordis.yml` 中的 `session-handoff` 行合并进目标 profile 的现有补丁，不要覆盖其他插件配置。重新构建 `lib/` 后需要重启宿主才会加载新代码。

## 使用

```text
/handoff
/handoff relative/new-output-directory
/handoff /absolute/new-output-directory
```

在 Web UI 中要从 `/` 命令菜单选中 `handoff`：选中后输入框变为 `/handoff `，可接着输入目录再回车。直接键入 `/handoff` 后回车，可能会作为普通消息发给模型。

无参数时输出到会话工作目录下的 `.dsh-handoff/<session-id>`。目标必须是新目录；插件不会覆盖已有交接包。导出失败会清理自己的临时目录。

```text
<output>/
  manifest.json
  native/
    session.v4.jsonl
    subagents/<session-id>/session.v4.jsonl
  artifacts/
    media/...
    files/...
  views/
    review.md
    handoff.md
    subagents/<session-id>/review.md
    subagents/<session-id>/handoff.md
```

- `review.md`：全部已提交事件的可读摘要，以及每个事件的完整原生 JSON。
- `handoff.md`：全部直接人类要求、当前原生 surface、工具未开始／结果未知状态、compact 与 lineage 信息、子会话链接和续跑边界。
- 两种视图中的 file/image 块都附有 `Package copy:` 链接，指向 `artifacts/` 下的副本；两种视图都链接递归子会话。
- `native/`：DSH 原生逻辑 JSONL，不是自定义事件格式。
- `manifest.json`：事件计数、恢复事件计数、文件哈希、递归关系和覆盖边界。

原始内容可能包含密钥和个人数据。导出文件以 `0600` 创建，目录以 `0700` 创建；外发前仍需单独审查。

## 一致性保证

- 读取活动会话前使用原生 flush 屏障。
- 原生日志、完整历史和当前 surface 之间做事件前缀、header 和 seq 一致性检查。
- 冷日志的中断修复事件使用 DSH 原生 `interruptedTurnClosers` 核对。
- 会话在导出期间发生无法解释的变化时，导出失败，不生成混合时点的成功包。
- 子会话或附件读取失败时，导出失败，不静默省略。

## 当前边界

- 导出的是**逻辑原生 JSONL**；不宣称与 JSONL 后端某个 `.zstd` 物理文件逐字节一致。
- 只包含 provider 已提交到原生日志的 reasoning；不包含隐藏思维链或未 settle 流。
- 不捕获工作区当前状态、未提交改动、后台进程、凭据或外部服务状态。
- 官方附件枚举只覆盖已声明的内置事件字段；未知事件 payload 中的附件引用不会被擅自推断。
- 真实 compact、单层异步子会话和真实附件的成功路径已验收；孙会话、fork 和 resume 的成功路径尚无真实样本。缺失后代、并发变更、缺失附件和已有目标目录的失败路径已验证。
- `handoff.md` 内容完整但偏大（约 100 条事件时约 110 KB），主要来自 surface 中的系统提示和 `stream` 数组；尚未做折叠。
- 子会话视图暂不链接回父会话。
