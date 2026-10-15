# dsh-long-context

面向 DSH `0.2.0-rc.2` 的通用长上下文插件，当前版本 `0.4.0-beta.1`。当前会话模型根据目标、材料范围、依赖和交付要求选择处理方式；插件负责有界执行、准确来源、预算、增量保存、恢复和文件保护。

简单问答或材料已在上下文中的短请求可以直接回答。需要跨窗口处理、持久进度或受管文件时，使用 `lc_work` 建立最小约定并执行首批工作，之后用 `lc_continue` 继续。插件内部完成装配、所需检查与交付，不再默认要求扫描、计划、逐块复核和最后手动完成。

没有翻译、总结等任务分类器，也没有额外 planner 调用。三种结果结构为连续内容、锚点修改、条目集合；综合允许多对一，短创作可以没有来源。引用、数量、日期和物理页数仅约束明确要求它们的任务。范围完整不等于语义正确，检查记录区分自检、会话提交和独立复核。

实验版限制：支持 UTF-8 TXT、Markdown、单文件 LaTeX 文本和原生文本 PDF 提取；尚不支持 OCR、DOCX 原位写回、多文件 TeX、保留 PDF 原版式。缺少编译器时 LaTeX 仍不能通过格式验收；明确要求物理页数时必须配置并校准渲染器。真实长论文质量仍需专门评测。

## 使用

新建工作区会话，选择 **Long Context**，直接描述目标。标题栏的 **长文工作台** 提供「材料」「处理请求」「任务」三个页签。「处理请求」把自然语言交给同一会话模型；不要求用户选择编辑、检索或生成流程。

默认暴露 13 个 `lc_*` 工具及宿主提问工具，不暴露 shell、任意代码执行或委托能力。安装不会改变 Standard 或已有会话的 preset。

核心工具：

- `lc_import / lc_inspect / lc_read / lc_search`：导入、准确读取和发现材料。普通读取不产生任务 journal；`lc_read` 返回可核验的阅读凭证。
- `lc_work / lc_continue`：执行有界批次；回执含最新 `journalRevision`、进度、产物和下一步，正常继续无需先查询状态。
- `lc_status / lc_task_detail / lc_result_read`：短状态与完整详情分开；大文本可以续读。
- `lc_discover`：有界 Crossref 元数据分页，不代表通用互联网搜索或正文证据。
- `lc_resume / lc_rollback / lc_export_report`：恢复、显式接管、候选回退和报告。新通用任务报告为 JSON；旧任务仍支持原 Markdown 报告。

例如无来源短创作：

```json
{
  "contract": {
    "request": "写一段介绍这份操作手册用途的文字",
    "output": {"kind": "segments", "path": "introduction.md"}
  },
  "requestId": "intro-1",
  "expectedLedgerRevision": 0
}
```

全文处理通过 `contract.sources: [{revisionId}]` 声明完整范围。模型可以提供语义 `units`，或采用有界默认切分；存储块不决定调用粒度。准确字面替换使用 `output.kind: "patches"` 与 `exactReplacements: [{from,to}]`，无需辅助模型。

主模型已经完成的内容可通过 `preparedResults` 提交，复用真实 `lc_read` 凭证，避免辅助模型再次生成。锚点修改应复用已提供的准确 anchor；更细位置先准确读取，不能猜测 SHA。产出调用包含目标自检，`review: "all"` 或指定 `reviewUnitIds` 才追加所需独立检查，已有义务不能取消。

原请求、来源范围和预算冻结。可重分待处理单元、增加依据与检查、修订指令并使实际依赖失效；改变目标或来源时明确结束旧任务并建立新约定，第一版不提供任意约定原位修改。相同 `requestId` 与参数重放不会重复有效提交；远端请求结果未知时保守记账，不承诺 provider 只收费一次。

输出写入新文件，不覆盖原稿。旧候选回退保留原语义；通用锚点修改的回退恢复基线**文本投影**到受管候选，不会把 PDF 原始字节写入文本候选。产物、提示和审计保存在工作区 `.dsh-long-context/`，包含材料正文，不应提交公共仓库。

## 构建、安装与验证

要求 Node.js ≥22.13、pnpm 11.1.2，DSH peer 精确锁定 `0.2.0-rc.2`。

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
dsh plugin --profile my-web-profile add /absolute/path/dsh-long-context-0.4.0-beta.1.tgz
```

重启目标 profile 后新建 Long Context 会话。根包提供 Web 入口，headless 组合使用 `/agent`、`/host`、`/compaction` 与 `bundle/headless.patch.yml`；纯核心使用 `/core`。卸载用 `dsh plugin --profile my-web-profile remove dsh-long-context`，账本默认保留。

集成在 `.acceptance/project/` 或 `.acceptance/native/` 的独立 DSH home 安装实际 tgz。机制测试使用受控 provider，不能替代真实模型质量。默认允许下载锁定依赖；缓存完整时可设置 `LC_INSTALL_OFFLINE=1`。

```sh
pnpm evaluate:general-performance
pnpm evaluate:general-model
```

性能脚本从 Git 基线 `a731f9c` 提取源码，在同机核对 6,000 次替换及完整恢复；不会删除审计换取空间。真实模型脚本使用已授权的 Web 配置和已存凭证引用；未显式覆盖时采用原生 `deepseek-official/deepseek-flash`，凭证仅传入隔离进程环境，不写入测试补丁。只有用户授权时才运行；原凭证文件在结束时核对未变。输出、盲评文件和完整本地调用记录位于被 Git 忽略的 `evaluation/runs/`。

旧版 `acceptance:model:rc2` 仍可用 `LC_MODEL_PROFILE` 指定独立认证 profile。所有未知、未运行和失败结果必须保留，不能以受控通过宣称真实质量。

## 旧任务与存储迁移

旧扫描、研究和逐页生成工具仅用于兼容原任务；默认新会话不展示。`lc_resume` 或恢复旧任务的检查点会在该会话注册兼容工具。旧客户端需要主动创建旧任务时，可显式配置 Host `legacyTools: true`；旧页数、引用和配额门槛不会自动放宽，也不会被标为新协议语义验收。

新 workspace 使用 v3 增量事件。已有 v2 workspace 可继续原接口恢复旧任务；开始新通用任务前必须显式升级。先停止该 workspace 的所有旧写入并备份，再在本源码仓库执行（安装包可调用下文的核心导出）：

```sh
node scripts/migrate-state.mjs /absolute/workspace .dsh-long-context --to-v3
node scripts/migrate-state.mjs /absolute/workspace .dsh-long-context --rollback-v3
```

迁移复制到新 generation、完整核验，再原子切换 manifest；保留旧 journal、owner、requestId 和检查语义。回退只恢复旧 generation 指针，不逆向转换新数据；新 generation 和产物仍保留，配合旧插件使用，不能把旧状态当最新完整数据。v1 先用原 `migrate-state.mjs` 无参数升级到 v2。核心也导出 `migrateV1 / migrateV2 / rollbackV2`。

Host 可配置 `auxiliaryModel: {provider, model, reasoningEffort, maxOutputTokens, deadlineMs}`、`rendererExecutable`、`rendererFontconfigFile`。默认沿用会话 route，不强制关闭推理。模型等待与渲染在工作区锁外，短事务保留 owner、CAS、取消令牌、文件 hash 与预算检查。

## 实施依据与证据

- [通用优化实施计划](docs/GENERAL_OPTIMIZATION_IMPLEMENTATION_PLAN.zh.md)
- [通用优化执行报告](docs/GENERAL_OPTIMIZATION_EXECUTION_REPORT.zh.md)
- [领域术语](CONTEXT.md)
- [DSH 兼容基线](docs/DSH_COMPATIBILITY.zh.md)
- [旧版安装及发布说明](docs/WEB_INSTALLATION_AND_RELEASE.zh.md)
- [历史优化报告](docs/OPTIMIZATION_EXECUTION_REPORT.zh.md)

npm 和市场尚未发布。本轮本地打包、隔离安装与真实模型评测不改变用户的默认 profile。
