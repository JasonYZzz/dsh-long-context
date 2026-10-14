# dsh-long-context

面向 DSH `0.2.0-rc.2` 的长文档主题修改插件。当前提供实验性的文本编辑核心：保存不可变原文、全文审查覆盖、影响项与依赖、候选稿、版本绑定验证及持久任务恢复。

已实现独立 `long-context` preset、15 个 `lc_*` 工具和 compaction 扩展。默认保留原稿，修改写入新候选文件；未完成覆盖、未解决依赖、陈旧版本和缺失检查会阻止 `lc_finish`。

当前范围是 UTF-8 TXT、Markdown、单文件 LaTeX，以及明确验收过的 PDF 文本提取结果。原生 PDF/DOCX、多文件 LaTeX、OCR、格式渲染和真实模型质量验收仍未完成；不能将本版本视为整份实施计划的最终交付。LaTeX 缺少编译验收时，格式检查保持 `unknown`，不会宣称通过。

## 开发与验证

要求 Node.js ≥22.12、pnpm 11.1.2；本机验证使用 Node.js 26.5.0。DSH 与 Cordis 使用锁定版本，采用 hoisted 依赖布局。

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm pack --pack-destination .acceptance
pnpm acceptance:preflight
pnpm acceptance:web:rc2
pnpm acceptance:mechanisms:rc2
```

集成测试会在仓库 `.acceptance/dsh-home` 建立独立 profile 并安装本次 tgz，不改变用户原有 DSH home。机制测试使用本地受控 provider，验证实际 DSH 请求中的 checkpoint、压力压缩、手动压缩、overflow 重试及压缩后的文本编辑闭环；这些结果不代表真实模型的语义质量。

真实模型测试需另行配置已授权的隔离 headless profile：

```sh
LC_MODEL_PROFILE=my-authorized-test-profile pnpm acceptance:model:rc2 /absolute/path/task.txt
```

缺少测试 profile 或任务文件时，该命令记录 `not-run` 并以状态码 2 退出，不复制用户原 home 的密钥。

## 安装与使用

构建打包后，将 tgz 安装到目标 Web profile：

```sh
dsh plugin --profile my-web-profile add /absolute/path/dsh-long-context-0.1.0.tgz
```

重启相应 Web profile，在新会话中选择 **Long Context**。该 preset 只提供文档任务工具与提问工具，不暴露终端、任意代码执行和委托工具。安装不会将它设置为 standard 或所有会话的默认预设。

基本流程：`lc_import` → `lc_task_start` → 重复 `lc_scan_next` → `lc_impact_review` → `lc_plan` → `lc_apply` → 逐块 `lc_verify` → `lc_finish` → `lc_export_report`。使用 `lc_inspect` 获取块定位，使用 `lc_read` 的 `nextCursor` 完整续读；写工具携带最新 `expectedLedgerRevision` 和稳定的 `requestId`。

- `lc_status` 分页查看权威账本；搜索命中不能代替全文审查。
- 扫描与复核沿用当前 DSH 模型 route；失败范围保持未完成，调用有重试和预算限制。
- `lc_resume` 从账本恢复；跨会话接管需要显式 `transferOwner`，fork 不自动获得写权。
- `lc_rollback` 在 hash/version 校验后将基线恢复到插件管理的候选文件，保留原稿。
- headless 组合使用 `bundle/headless.patch.yml`，不与默认 compaction provider 重复加载。

卸载：`dsh plugin --profile my-web-profile remove dsh-long-context`。卸载解除插件配置，默认保留工作区 `.dsh-long-context/` 中的任务数据；需清理时先自行备份与确认范围。该目录包含原文和模型请求内容，不应提交到公共仓库。

## 评测与文档

`pnpm evaluate:fixtures` 生成 10 份各 100 页的固定文本样本，原文在隔离工作区，gold 在 `evaluation/gold/`，不能把 gold 提供给模型。`evaluate:gold` 对指定原稿和候选稿评分，`evaluate:report` 汇总任务成功率和置信区间。没有实际运行的指标保持未知。

完整运行证据位于本地 `evaluation/runs/`，依赖、测试数据、运行请求、打包产物与缓存均被 Git 忽略。发布包仅包含编译代码、bundle、文档和许可证，不包含论文或测试运行记录。

- [开发状态及当前限制](docs/DEVELOPMENT_STATUS.zh.md)
- [完整实施计划](docs/IMPLEMENTATION_PLAN.zh.md)
- [本机实际验收计划](docs/ACCEPTANCE_PLAN.zh.md)
- [DSH 兼容基线](docs/DSH_COMPATIBILITY.zh.md)
- [领域术语](CONTEXT.md)
