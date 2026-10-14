# DSH 兼容基线与本机环境

> 开发进度更新（2026-10-14）：实验性文本核心及部分 rc.2 安装/机制验收已有实现；本文保留原始计划与历史核查记录，当前交付和未完成项以 [开发状态](DEVELOPMENT_STATUS.zh.md) 为准。

记录日期：2026-10-13（Asia/Shanghai）。本文件区分已核实事实与未来验收步骤。

## 已核实事实

- 当前终端 PATH 没有 `dsh` 命令，但存在本机 npm 缓存安装。
- 安装根：`/Users/mac/.npm/_npx/1e7f6d9597241db0/node_modules`。
- CLI 入口：`@deepseek-ai/dsh/lib/bin.js`。
- 已实际执行 `node /Users/mac/.npm/_npx/1e7f6d9597241db0/node_modules/@deepseek-ai/dsh/lib/bin.js --version`，输出 `0.2.0-rc.2`。
- 已实际执行上述入口的 `--help`。支持 `--profile`、`--from-default-profile`、重复 `--patch`、`--dump-config` 和 `--dump-default-config`；支持 `dsh plugin --profile <profile> add <package>`。
- 相关 DSH 包版本为 `0.2.0-rc.2`，Cordis 为 `4.0.4`；详见 [环境证据](evidence/local-dsh-rc2.json)。
- 存在 `/Users/mac/.dsh`。没有读取其凭据文件，也没有改写现有 profile。
- 检查时 TCP 3080 没有发现监听进程；这只能说明该端口在检查时的状态，不能推断用户没有从其他端口或入口运行 DSH。

## 已核实的扩展能力

本机 `lib/types` 与 `lib/index.js` 中存在 `systemPrompt.context()`、`systemPrompt.variable()`、`tools.guard()`、`agent/pre-step`、`agent/turn-stopping` 和 `agent.steer()`。`BasicCompactionEngine` 导出，并声明 `protected summarize()` 为摘要定制点。

本机 `PromptContext` 只有 `name/order/text`。不能使用较新源码中的 `required` 或 context 的 `interpolate` 字段。字符串变量替换的值不会被再次扫描，故动态数据通过固定 `{{longContextPacket}}` 引用加 variable provider 提供，避免文档内 `{{...}}` 被当作模板变量。

本机 agent-loop 在运行 `agent/pre-step` waterfall 前已组装 runtime snapshot；不能仅凭注册动态 context 就宣称同一次压缩后的即时请求会恢复状态。主方案采用插件自己的 pre-step 恢复，再通过 `BasicCompactionEngine.summarize()` 把确定的任务检查点附入压缩摘要。完整集成测试必须验证压力压缩、手动压缩和 overflow 即时重试三条路径。

## 首版约束

1. 首版 DSH peerDependencies 精确约束 `0.2.0-rc.2`；Cordis 按实际验证的 `4.0.4` 声明，之后仅在兼容矩阵通过后扩大范围。
2. 只从 package exports 中的公开入口导入；不得依赖 cache 绝对路径、`lib` 私有子文件或修改安装目录。缓存路径只用于当前机器启动与只读核查。
3. 不增加 DSH 核心 SessionEventMap 类型，不使用 experimental `appendPluginRecord` 存放关键状态。任务账本独立持久化；模型可见状态通过正常 user/message 或 compaction checkpoint 写入 DSH 日志。
4. 通过独立 Web preset 和 headless overlay 安装；保持单一 `ctx.compaction` provider。自定义 compaction 在任务未激活时完全委托 BasicCompactionEngine。
5. 不为安装通过而设置版本豁免。P0 必须验证打包产物可被真实 rc.2 loader 解析。
6. 源码参考提交 `d743267388641bc76f17c45ce8b4c231aed1d32c` 的 package version 为另一个开发版本；它是分析依据，不是本机运行版本。

## 尚未执行

插件安装、Web 启动、完整 profile dump、API 模型调用、论文编辑、压缩恢复与浏览器验收均尚未执行。本轮只完成计划及上述只读核查。
