# dsh-long-context 完整开发实施计划

> 开发进度更新（2026-10-14）：实验性文本核心及部分 rc.2 安装/机制验收已有实现；本文保留原始计划与历史核查记录，当前交付和未完成项以 [开发状态](DEVELOPMENT_STATUS.zh.md) 为准。

测评后的原生宿主适配、缺陷修复、组合检索和逐页生成执行顺序见[完整优化实施计划](OPTIMIZATION_IMPLEMENTATION_PLAN.zh.md)。本文保留原始设计与历史估算。

计划开始：2026-10-13；更新：2026-10-14（Asia/Shanghai）。项目目录：`/Users/mac/dsh/dsh-long-context`。本轮交付实施计划，不创建插件实现、安装依赖或运行付费模型任务。

## 1. 目标与可交付结果

为 DSH 提供一个可安装的外部插件及独立 `long-context` preset，使用户可以对 100 页论文执行主题修改：先建立完整文档范围和原文定位，再识别主题影响及跨章节依赖，逐项生成候选稿，最后输出修改与验收报告。继续任务时，以持久任务账本恢复工作，而不是依靠会话摘要保留全部证据。

交付一个 npm 包 `dsh-long-context`，不占用 `@deepseek-ai` 官方命名空间。发布产物包括 Host 插件、Agent 插件、compaction 扩展、bundle patch、TypeScript 类型、工具说明、安装/卸载说明、迁移说明和可重复的验收工具。

首要运行目标是本机 **DSH Web 0.2.0-rc.2**，其次是同版本 headless。此前分析的 GitHub 固定提交只作为设计依据；兼容性以本机已安装包的 exports、类型、行为及实际验收为准。版本差异记录见 [兼容基线](DSH_COMPATIBILITY.zh.md)。

项目需要保证的是：原始证据不会因会话压缩而成为唯一无法恢复的数据；未处理范围、版本冲突、未解决依赖和失败检查均不能静默标为完成。模型是否正确理解主题、论文论断是否成立，仍需实测及相应的学术审阅，不能承诺任意论文 100% 正确。

### 1.1 首版支持范围

| 能力 | v0.1 可用核心 | v0.2 文档扩展 | v1.0 发布候选 |
|---|---|---|---|
| TXT / Markdown / 单文件 LaTeX | 导入、读取、定位、完整扫描、候选稿与验收 | 更完整引用与编译支持 | 可重复验收和安装 |
| PDF | 可导入已验收的带页码提取结果 | 原生文本 PDF 分页提取与版面问题标记 | 100 页原生 PDF 实测；扫描版按能力明确降级 |
| DOCX | 不宣称原生写回 | 段落/表格定位与候选副本 | 导出、渲染、格式保真验收 |
| 多文件 LaTeX | 首版只接受单文件或用户提供的已展开源 | 项目级依赖与分文件编辑 | 编译、引用和崩溃恢复验收 |
| OCR / 复杂公式 / 图像推理 | 不作为首版默认能力 | 可选 extractor / OCR，记录质量和未覆盖区域 | 按独立评测通过情况发布，不能虚报覆盖 |
| Web 运行 | 使用现有通用工具卡及结构化报告 | 可选专用状态卡 | 真实安装、重启、恢复、卸载 |
| 模型及检索 | DSH 已选模型、词法检索加全文主题扫描 | 可选 embedding/rerank | 多模型比较，但只宣称已测试组合 |

首版闭环应能处理 100 页的可编辑文本材料；完整 PDF/DOCX 工作流作为后续里程碑交付，而不是用格式转换占位替代真实可用性。

## 2. 分析结论到需求的对应关系

| 已发现问题 | 插件需求 | 实现位置 | 验收依据 |
|---|---|---|---|
| 文件附件只提供 handle | 显式导入与提取验收 | Document Module | PDF 页、块、提取异常可查看 |
| read 行长/字节裁剪 | 按块和 Unicode 范围完整读取、有续读 cursor | Document Module / lc_read | 第 2501 字符后的内容可完整续读 |
| grep 非语义查全 | 搜索用于发现，另对每块做主题审查 | Analysis Module | 低词面重合的 gold 影响项召回 |
| 会话压缩会丢细节 | 原文与任务账本独立持久化，摘要含确定检查点 | Ledger / Context Module | 压缩和重启后可以回读完整证据 |
| 默认 pruner 会裁中间 | 自有工具输出显式分页，小于有效裁剪预算 | DSH Agent Adapter | 正常和强制压力下无静默裁剪 |
| 摘要只检查缩短 | 必要状态字段程序校验，证据以原文定位引用 | Compaction Adapter | 缺 taskId/revision/未完成统计则拒绝 checkpoint |
| edit 成功不代表主题完成 | 影响项逐项关联 patch，严格任务完成门槛 | Change / Verification Module | 缺项、误改、依赖未解决均不能完成 |
| 版本保护只防陈旧写入 | 内容版本、定位、扫描、方案、验收均有版本绑定 | 所有 Module | 外部编辑后旧结果失效 |
| 性能 benchmark 不能说明质量 | 真实 Web 和模型端到端评测 | Evaluation Module | 整篇成功率及完整日志 |

原分析：[源码分析与机制评测报告](/Users/mac/dsh/research/dsh-long-context-review.zh.md)。

## 3. 核心设计决策

### 3.1 保留 DSH 执行循环与默认压缩事务

插件在公开扩展位置注册工具、上下文和守卫，不修改 DSH agent-loop。`BasicCompactionEngine.summarize()` 是本机已有的定制点，派生实现先调用 `super.summarize()`，然后附加来自当前任务账本的确定检查点。继承原有区间选择、锁、来源引用、缩短检查、取消和记录机制，不重写 compaction 事务。

参考：[BasicCompactionEngine 摘要扩展点](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/compaction/compaction-basic/src/index.ts#L220-L239)。本机存在对应声明，实际兼容须由 P0/P4 验证。

### 3.2 任务账本是进度事实，原文版本是证据事实

任务账本保存目标、扫描范围、影响项、依赖、修改与检查结果；原文内容单独按不可变版本保存。会话摘要只保留任务检查点、定位和当前动作。不能由一个模型生成的摘要反推未保存的完整原文，也不能把模型输出的“完成”直接写为任务完成状态。

### 3.3 全文范围审查优先，检索结果不能代替覆盖

首版词法检索不使用 embedding 作为完成前提。每个内容块都必须有主题审查记录；对 alias、指代和章节依赖做补充扫描。记录“已审查范围”与“识别出的影响项”两个不同指标。即便全部块已审查，语义召回仍需 gold 评测。

### 3.4 写入候选稿，原稿可保留

默认在授权工作区输出新候选文件，不覆盖原始论文。补丁先完整构造、逐项验证，再提交为新的 CandidateRevision。v0.1 的原子承诺限于一个文本输出文件；v0.2 多文件项目采用持久提交日志与可恢复分阶段提交，不宣称普通文件系统提供多文件原子事务。

### 3.5 局部补丁必须考虑全篇依赖

依赖图用于列出需要复查的位置，而不是当作已经被证明的因果关系。所有推断关系记录原文引用、推断理由、来源与检查状态。改变根定义、假设或数值时，关联影响项和既有验收结果自动失效，重新检查；不允许旧检查跨版本沿用。

## 4. 代码组织与模块接口

先采用一个 npm package 和一个 TypeScript 工程，不拆成多个发布包。内部 Module 通过小 Interface 组织行为；仅在确实有两个实现时设置 Adapter seam，避免提前建设大规模插件平台。

```text
dsh-long-context/
  package.json
  tsconfig.json
  src/
    core/
      document/         文档版本、块、定位、范围读取与提取质量
      ledger/           状态转换、持久日志、覆盖和版本失效
      analysis/         全文主题审查、候选影响项与依赖核查
      changes/          修改方案、原文匹配、候选版本与回退
      verification/     确定性检查、模型复核、完成条件
      context/          检查点、证据选择、预算与摘要恢复
      ports/            确实变化的文件、提取、模型与记录接口
    dsh/
      host.ts           Workspace 与任务注册、生命周期
      agent.ts          scoped 工具、提示和执行守卫
      compaction.ts     BasicCompactionEngine 的摘要扩展
      model.ts          ctx.llm 调用与辅助请求审计
      fs.ts             ctx.fs 及 sandbox/approval 适配
      presentation.ts   纯工具展示与有界 meta
      compatibility.ts  rc.2 能力探测及明确拒绝
    extractors/
      text.ts
      pdf.ts            v0.2
      docx.ts           v0.2
  bundle/
    host.patch.yml
    long-context.preset.patch.yml
    headless.patch.yml
  scripts/
    acceptance-preflight.mjs
    generate-fixtures.mjs
    score-evaluation.mjs
    export-report.mjs
  tests/
    unit/
    integration/
    replay/
    e2e/
    fixtures/
  docs/
  evaluation/
```

以上是未来结构，本轮只建立文档。选用 TypeScript strict、Node ESM、pnpm、Vitest；具体工具链版本在 P0 结合本机 DSH engines 验证并锁定，不使用 latest 浮动依赖。

### 4.1 Module 责任与主要 Interface

| Module | 主要行为 | 调用者需要知道的条件 |
|---|---|---|
| Document | import / inspect / readRange / locate | 所有读写绑定文档版本；范围不能静默截断 |
| Ledger | dispatch / snapshot | command 携带 expectedLedgerRevision 与 requestId；状态转移和幂等由内部负责 |
| Analysis | scanNext / resolveDependencies | 每个扫描输入固定原文版本；失败块不标 reviewed |
| Changes | propose / applyToCandidate | 只接受有依据且匹配 expected text 的 patch；多项提交先校验再写 |
| Verification | verify / evaluateCompletion | 检查范围与候选稿版本一致；缺失结果是未知而非通过 |
| Context | buildCheckpoint / selectEvidence | 必需字段不会因预算不足被截掉；不足时返回错误或更短合法索引 |

真实 Adapter：TextExtractor 与 PDF/DOCX Extractor；DSH Model Adapter 与测试 FakeModel；LocalRecordStore 与测试 MemoryRecordStore。排序、范围合并、依赖判定、状态转移等逻辑不依赖 DSH 服务，以公共 Interface 做测试。

### 4.2 发布 exports

- `dsh-long-context/host`：Host 状态与 Workspace 注册。
- `dsh-long-context/agent`：每个 Agent 的工具与任务上下文；根 export 可别名指向此插件。
- `dsh-long-context/compaction`：单一 compaction provider 替换项。
- `dsh-long-context/core`：不导入 Cordis 的核心类型与 Module Interface。
- `dsh-long-context/bundle` 或 manifest 的 `dsh.bundle.patch`：声明安装用的组合，格式以 rc.2 bundle 验证器为准。

Cordis 与 DSH 包作为 peerDependencies 并在开发依赖中固定；构建时 external，不打包第二份 Cordis、tools registry 或 sessions。安装前检查依赖只解析到宿主同一实例。

## 5. 领域数据与必须成立的条件

领域词义见 [CONTEXT.md](../CONTEXT.md)。所有 ID 采用品牌类型，持久记录 JSON 可验证，schemaVersion 独立于 DSH Session format。

| 数据 | 必需字段 |
|---|---|
| DocumentRevision | documentId、revisionId、原文件 sha256、提取器版本、提取配置 hash、格式、源定位信息、块清单 hash、质量异常 |
| DocumentBlock | blockId、revisionId、章节路径、页范围（存在时）、原文范围、完整 Unicode 长度、内容 hash、前后块关系 |
| SourceAnchor | revisionId、blockId、Unicode 码点 start/end、选中文本 hash、页/行/结构路径显示信息 |
| ReadReceipt | sessionId、taskId、anchor、返回完整范围、是否有 nextCursor、最终 model-visible result 的来源 seq、surface generation |
| TopicChange | request 原文、结构化 changeGoal、范围、aliases、mustPreserve、不应修改的类型 |
| ImpactItem | anchor、decision=change/keep/uncertain、原文 evidence、理由、关联 claimId、审查来源、状态 |
| DependencyEdge | from/to、relation、evidenceAnchors、explicit/inferred、resolution、影响稿版本 |
| Patch | itemId、baseRevisionId、anchor、expectedOriginal、replacement、理由、约束及 hash |
| VerificationRecord | candidateRevisionId、scope、checkKind、checker、模型/规则版本、evidence、passed/failed/unknown、问题列表 |
| TaskLedger | taskId、ownerSession、workspaceId、documentRevisions、状态、覆盖、影响/依赖/patch 列表、预算消耗、journalRevision |

必须成立：

1. 页码和行号主要用于显示，写入依据为版本及精确内容范围；跨修订定位不能自动沿用。
2. 分块时所有可提取文字都进入一个或多个块，覆盖区间无缺口；重叠窗口不重复计入覆盖率。按 Unicode 码点计数，编码字节到字符偏移有显式映射。
3. 很长段落可在句界或 Unicode 范围分割，保留前后关联；无法分割的公式/表格有独立类型及显式异常，不裁掉尾部伪装完整。
4. cursor 绑定 revision、范围和分页位置。版本改变返回 `LC_STALE_CURSOR`，不返回新旧混合内容。
5. Evidence quote 必须在对应原文范围内精确匹配。无法对齐的 LLM evidence 进入待核查列表，不生成可应用 patch。
6. Coverage 的 read、topicReviewed、changeResolved、verified 分开统计；只读第一块不能批准整篇修改。
7. ReadReceipt 只证明相应内容完整进入 model-visible result，不证明模型理解。发生 surface replacement 后，依赖旧 receipt 的当前操作重新回读小范围证据。
8. 源文件外部变化、mustPreserve 修改、主题范围扩大，会使相应扫描/方案/验收状态失效。
9. 空检索结果、空模型输出、超时、schema 校验失败均不是“无相关内容”。
10. 学术正确性等级显示为 structural_only / model_reviewed / human_reviewed，不由模型自行填写 human_reviewed。

## 6. 持久化、并发与崩溃恢复

### 6.1 首版存储选择

采用本地 RecordStore 的逐条不可变 JSON journal，加不可变原文对象及周期 snapshot；首版不引入向量数据库。部署 stateRoot 默认是明确配置的工作区 `.dsh-long-context/`，通过 Host 对该根的授权验证创建。Host 内部可以使用 Node 文件 I/O 保存插件自己的状态，但不得借此读取或修改论文：论文路径始终经 DSH `ctx.fs`、sandbox 与 approval；仅支持验证过的本地执行世界，远程 provider 返回明确能力错误。

```text
.dsh-long-context/
  manifest.json
  objects/<content-hash>
  documents/<document-id>/revisions/<revision-id>.json
  tasks/<task-id>/journal/0000000001.json
  tasks/<task-id>/snapshots/<revision>.json
  tasks/<task-id>/reports/
  locks/
```

对象和报告含论文内容，默认只存本地，纳入用户备份/清理范围；README 明确不应提交论文状态目录到公共仓库。任务 journal 的状态引用不放凭据或完整环境变量。

### 6.2 提交协议

先生成并验证事件；在 workspace 写锁内检查 expected revision；写同目录临时文件，flush 文件并原子 rename 为下一条记录，更新已验证 snapshot；缓存只在记录已持久化后发布。启动时校验序号连续、前一条 hash 和 schema，忽略未提交临时文件。snapshot 可删除重建，原文对象和 journal 不可被摘要替代。

不能用 fire-and-forget `session/event` listener 完成关键状态持久化，因为它不阻止已提交事实。模型工具成功返回前等待自己的 journal commit；DSH tool/result 记录 requestId 和 journalRevision。若状态已提交但 tool/result 丢失，重试相同 requestId 返回同一结果，不重复扫描记账或写候选稿。

### 6.3 并发规则

每个文档一个活跃写任务；不同任务可读取同一不可变版本。一个任务只允许一个 owner session 写，观察 session 只读。fork 默认继承 task reference 而不继承写权；接管必须明确记录 owner 变更。锁和 revision CAS 双重检查，不以锁 TTL 自动夺取活跃写入者。进程退出后能确认失效的本机锁可恢复；不能确认时保持冲突状态并提供显式恢复操作。

v0.2 多文件候选提交采用 prepare → staged → committing → committed journal；崩溃时按逐文件前后 hash 收敛为已提交或待恢复，不覆盖 hash 不匹配的文件。首版 rollback 仅还原插件自己输出、且仍符合预期 hash 的候选文件；原稿不受影响。

## 7. 文档导入与完整读取

### 7.1 文本与 LaTeX

读取原字节、确认编码、保存不可变版本；保留换行和原文坐标，另建 normalized text 供搜索。分块默认目标 4,000 Unicode 码点，最大 6,000；章节和句子边界优先，不改变原稿。对任意超长行提供 character cursor，分段返回原内容，输出 `completeRange/nextCursor`。

LaTeX 首版把正文和公式源当文本保留，识别 label/ref/cite 及基本结构；不要用正则改写任意 TeX 宏。编译条件、文件包含和参考文献解析在 v0.2 项目适配中扩展。

### 7.2 PDF / DOCX（v0.2）

PDF Extractor 选择维护中的解析库，开发时依据其官方说明锁定版本并验证 Node 兼容；按页保存 text items、阅读顺序及图像/公式异常。文本层不足、双栏顺序异常、页缺失等标为 qualityIssues；纯扫描 PDF 只有在可选 OCR 提供者配置并实际验收后才允许按提取文本继续，否则输出待提取状态。

PDF 到可编辑源的映射不是必然可逆。默认产出带定位的 Markdown/LaTeX 候选稿与变更报告；若用户要求原 PDF 版面修改，必须有已验收的源格式或单独实现编辑适配，不能靠生成一个 PDF 冒充原稿精确回写。

DOCX 按段落、run、表格单元格和关系 ID 保存结构定位，只编辑允许的文本结构，保留未涉及的样式与媒体。输出副本，渲染对比；无法保真的内容拒绝自动写回并列出位置。

## 8. 主题扫描、依赖与检索

### 8.1 主流程

1. `lc_task_start` 固定文档版本、主题目标、约束及评测范围。
2. 词法发现：术语、别名、章节标题和交叉引用产生候选，不能把剩余块标为无关。
3. `lc_scan_next` 遍历全部块，每次最多处理一个块及有界相邻上下文；Auxiliary Model Adapter 使用用户已选 DSH route，生成结构化判断。
4. 校验 JSON schema、evidence quote、anchor、decision；失败时该块保持 pending，有限重试后标 unknown。
5. 第二遍：根据新增 aliases、指代和根定义关系，复查受影响块并解析跨章节引用；循环直到没有新增未解决项，或达到预算并进入 needs_attention。
6. `lc_impact_review` 记录每个候选 change/keep/uncertain；keep 必须有理由，uncertain 不能被计为完成。
7. `lc_plan` 输出候选修改方案，绑定完整影响清单与依赖检查要求。

不使用“模型 confidence 大于某阈值”作为完成条件。依赖的 explicit 来自可定位的文内引用；inferred 来自模型判断，保留区分。根假设变更若需要新增理论证明或实验数据，返回 needs_evidence，不自动编造证明和结果。

### 8.2 模型调用可追溯性

通过 `ctx.llm` 的现有 route 与凭据机制调用，不配置新的 API key 存储。辅助分析、摘要和复核每次记录 purpose、完整输入引用及实际输入文本 hash、模型配置、原始输出、usage、结束原因、解析错误、耗时和重试。调用内容需要能从插件 journal 的不可变对象重建；不能只记录“用过这个 blockId”而丢失实际 prompt。

请求模板有版本号；Raw 文档是数据，不能作为工具指令。检索和扫描不能执行文档中的命令。重试不得无界；超过 deadline 或输出截断时不标成功。

## 9. 模型工具契约

工具名称以 `lc_` 区分默认 DSH 工具。下列是待实现契约，不是已经可调用的工具。输出由 canonical JSON value、模型可见简短 render、纯 presentation metadata 三部分组成。

| 工具 | 主要输入 | 主要输出 / 前置条件 |
|---|---|---|
| lc_import | path、format、提取选项 | documentId/revisionId、块清单、质量问题；未通过提取验收不可编辑 |
| lc_read | revisionId、blockId/range、cursor | 精确正文、anchor、completeRange、nextCursor；不按原行长截断 |
| lc_search | revisionId、query、cursor | 命中与 locator；明确 incomplete/total，不作为全文覆盖 |
| lc_task_start | revisionIds、goal、mustPreserve、scope | taskId、固定基线、扫描计划、预算；同文档写任务冲突拒绝 |
| lc_scan_next | taskId、expectedLedgerRevision、requestId | 一个范围的审查、evidence、pending 计数；内部调用模型 |
| lc_impact_review | taskId、itemIds、decisions、证据 | 更新后的影响清单及未决问题 |
| lc_plan | taskId、expectedLedgerRevision | versioned ChangePlan、逐项 patch、依赖条件；必要 evidence 当前可读取 |
| lc_apply | taskId、planId、outputPath、requestId | CandidateRevision、diff、提交记录；源/目标版本和权限匹配 |
| lc_verify | taskId、candidateRevisionId、checkScope | 确定性/模型检查及失败位置；所有结果绑定候选版本 |
| lc_status | taskId、cursor | 覆盖统计、待办、依赖、预算、journalRevision |
| lc_finish | taskId、candidateRevisionId | 完成记录或明确剩余问题；不是自由填写 success=true |
| lc_resume | taskId | 恢复或显式转移写 owner；校验对象与源文件版本 |
| lc_rollback | taskId、candidateRevisionId | 只回退插件管理的候选输出，检查 hash 和权限 |
| lc_export_report | taskId、format、outputPath | 持久报告与证据索引，长报告不塞进一次工具结果 |

写 journal 的工具要求 requestId 幂等和 expectedLedgerRevision；只读工具允许并发。v0.1 先实现文本闭环所需工具，`lc_resume/rollback/export` 随持久写入一起交付，不能留给发布后补。

## 10. 上下文、压缩与任务恢复

### 10.1 任务检查点

必要内容：taskId、journalRevision、文档基线与候选版本、目标及 mustPreserve 的精确引用、状态、覆盖统计、待处理项计数、未解决依赖计数、下一合法操作、证据索引/报告位置、checkpoint hash。只放当前操作需要的少量项；完整清单可以通过 lc_status 和 lc_read 分页回读。

检查点不得宣称已完成的比例等于准确率。大清单只能缩成明确的引用和计数，不能截成不完整 JSON。若必须保留的目标或约束无法装入预算，进入 `LC_CHECKPOINT_TOO_LARGE`，不能删除约束继续。

### 10.2 rc.2 双层恢复

- **请求前**：Agent Adapter 在 `agent/pre-step` 中 `await next()`，保留 reject 及所有 decision 字段。对 enter 决策核对当前 surface 和此次进入 messages，必要时附加 `createUserMessage` 生成的当前检查点。所有进入模型的文字由 DSH 正常写为 user/message。读取账本在可取消阶段完成，文本渲染使用已提交 snapshot。
- **压缩后即时重试**：Compaction Adapter 在支持的 `summarize()` 定制点调用 super，给返回 summary 附上确定的检查点。保留 super 的 rawOutput/usage 等字段，区分模型原输出与插件附入的状态。checkpoint 作为实际 summary 被默认事务记录、替换并通过 shrink gate；不得私改 request messages。
- **手动 /compact**：同一 summarizer 定制点生效；下一轮 pre-step 再核当前 revision。
- **非活动任务**：完全使用默认 summary；不提供空检查点或全局污染其他 Agent。
- **回放与重启**：历史模型请求使用 DSH 当时记录的真实检查点；当前任务恢复使用外部 journal。不能以新状态改写旧请求的历史。

`MessageSourceMap` 可声明插件自己的 `long-context` user message 来源；关键账本不用新增核心 SessionEventMap。必须验证持久 decoder、Web 显示、fork 和 replay 都接受该来源，否则采用 rc.2 已支持的通用 user-message 来源并在不可变正文标记 owner。

### 10.3 预算策略

初始可配置目标：工具单次总 render ≤ 7,000 Unicode 码点（含 metadata 和 footer），检查点 ≤ 4,500 码点。实际 cap 要取插件配置、当前 pruner threshold 和模型剩余窗口中的最小安全值；正文不够时缩小范围并返回 nextCursor。所有 tunable 字段经过 schema 校验，不把这些初值写死为算法常量。

不关闭默认 compaction 来掩盖问题，不扩大默认 read 的上限来替代范围读取。首版无需替换默认 pruner，因为自有结果分页且完整原文已持久化；额外配置降低 threshold 时必须校验输出预算，太小时明确拒绝激活。

若定制摘要加 checkpoint 后不能缩短，默认 shrink gate 拒绝该次压缩。插件展示压力/预算错误并保留可恢复任务；不能为通过而抛弃必需状态。正常阈值与 overflow 路径分别测试，不能以一次手动压缩代替。

## 11. 修改、验证与完成状态

### 11.1 状态转换

```text
imported → extraction_checked → scanning → impacts_reviewed → planned
  → candidate_created → verifying → completed_with_checks

任何阶段 → needs_attention / failed / cancelled
源内容或目标变更 → stale → 指定失效范围重扫
验证失败 → planned（修正方案）或 needs_attention
```

Task 状态由合法 command 计算。模型只能提交审查和方案数据，不能直接把任意状态改为 completed。

### 11.2 应用前检查

确认源文件与基线 hash 一致、所有 patch anchor 精确匹配、无冲突重叠、每个 patch 关联 change item、keep 项未修改、所有 source rights 和 output roots 有效。针对单个候选文本，在内存/临时稿中构造全部修改，从大偏移到小偏移应用，形成新 version 并复核 hash，再原子创建输出；目标已有文件未经明确指定与版本校验不能覆盖。

只要出现 stale source、未知提取区域、未审查的主题范围或未解决关键依赖，就不能完成正式 apply。可允许输出标注为 draft 的候选，但 draft 不能进入 completed_with_checks；两种操作在工具结果和报告中明确区分。

### 11.3 验收层次

- 确定性检查：修改列表完整、版本一致、精确原文匹配、保护区域 hash、未涉及内容保持、编码与结构、标签/引用目标存在。
- 模型语义复核：目标是否实现、定义与实验/讨论/结论一致、例外是否保留、是否新增无依据事实。复核使用原始与候选 evidence，不能只读编辑模型的摘要或解释。
- 格式验收：文本可重新解析；LaTeX 可配置编译；DOCX/PDF 导出渲染对比。外部编译器输出有明确状态，环境缺工具时是 unknown。
- 领域审阅：对假设、公式证明、实证结论变化列出审阅要求。没有真实人工输入时不得标 human_reviewed。

### 11.4 终止守卫

`lc_finish` 要求提取异常已解决、所有 scope 块 topicReviewed、所有 impact 决策已落实、关键依赖 resolved、所有必需验证通过，且候选版本未变化。

`agent/turn-stopping` 有未决项时以 `agent.steer()` 注入简短纠正与下一工具建议，最多 2 次；取消、用户停止、needs_attention、预算耗尽均不自动继续。纠正次数与最后进度记录到 ledger，避免无进展循环。

该 hook 能决定是否增加后续 step，不能撤回模型已经流式输出的“完成”文字。因此产品的权威完成依据是 `lc_finish` 和持久报告，不能宣称已经从底层禁止任何自然语言误报。

## 12. DSH 组合与实际安装方案

### 12.1 Web 专用 preset

Host bundle 只挂一份 Workspace/RecordStore hub。新增 `long-context` preset，不替换用户现有 standard，也不把它设成所有会话的默认。preset 内使用独立 compaction isolate：装载自定义 compaction provider 和原 pruner；不同时加载 Basic 与自定义两个 provider。

Agent 插件、工具和 context 通过 `agent.ctx` 作用域注册；服务 Hub 校验 workspace 与 session 写 owner，避免通过共享 Host 访问另一工作区论文。加载顺序按依赖可用性处理，不以 YAML 行顺序当生命周期保证。

严格编辑 preset 仅暴露文档/任务工具及必要只读工具、提问工具；不暴露 bash/pwsh/terminal、任意代码执行或可获得这些能力的委托工具。对 generic write/edit 注册 monotonic guard：有活动受管任务时要求通过 lc_apply。内部转换器和候选写入仍按 DSH 权限处理。若用户外部编辑，版本失效检测兜底。

观察模式 overlay 可以装入 standard，不禁止既有工具；但必须清楚标为 advisory，不宣传严格修改约束。先验收 strict preset，再发布 advisory。

### 12.2 Headless

单独 overlay 挂载 Host 和 Agent 插件，明确替换默认 compaction-basic 行。作为无 Web 的回放和评测入口；工具 canonical output 与 Web 相同。

### 12.3 UI

v0.1 使用现有通用卡、定位链接及持久 Markdown/JSON 报告。output.presentationMeta 有 schema 与尺寸上限，不存整个论文。Host presentCall/presentResult 是纯函数；专用 Web 卡在 v0.2/1.0 用独立 Client export 注册，不误认为 Host presenter 自动改变 Web。

参考：[工具 canonical value、render 与 Web 展示](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/docs/cookbook/adding-a-tool.md#L55-L85)。

## 13. 配置与错误行为

| 配置组 | 初始决定 |
|---|---|
| deployment | stateRoot 显式解析；mode=strict/advisory；本地 provider 支持矩阵 |
| document | blockTargetCodePoints=4000、blockMaxCodePoints=6000；输入大小/页数有配置上限 |
| context | maxToolResultCodePoints=7000、maxCheckpointCodePoints=4500；阈值配置校验 |
| scan | 每次 1 块；上下文邻居有总预算；模型 deadline 初值 45s，额外重试最多 2 |
| model | 默认沿用当前 route；可单独指定 scanner/verifier route，必须实际声明并评测 |
| limits | task 总 token、费用可估算范围、调用数及最长耗时可设；unknown usage 不按 0 算 |
| verification | required checks；需要学术审阅的任务类型；编译器配置 |
| continuation | 最大纠正 2 次；失败/取消/needs_attention 时停 |

预算未配置时使用文档化的调用数和 token 安全初值；在线评测前冻结明确的最大 token/调用数/墙钟预算。费用无法精确测得时记录 usage 和价格来源，不能虚报节省金额。所有阈值是初始工程选择，须用验收数据调整，不是已证明的最佳值。

核心错误族：`LC_EXTRACTION_INCOMPLETE`、`LC_FORMAT_UNSUPPORTED`、`LC_STALE_REVISION`、`LC_STALE_CURSOR`、`LC_OWNER_CONFLICT`、`LC_EVIDENCE_MISMATCH`、`LC_PATCH_CONFLICT`、`LC_COVERAGE_INCOMPLETE`、`LC_DEPENDENCY_UNRESOLVED`、`LC_VERIFICATION_FAILED`、`LC_CHECKPOINT_TOO_LARGE`、`LC_RESULT_BUDGET_TOO_SMALL`、`LC_BUDGET_EXCEEDED`、`LC_STATE_CORRUPT`、`LC_PERMISSION_DENIED`、`LC_DSH_INCOMPATIBLE`。

错误返回 code、可定位 scope、是否可重试、下一合法动作；敏感内容留在授权报告，不放系统日志。失败不落到“保持原有 success”；非活动文档任务不影响一般 DSH 会话。

## 14. 开发阶段、工作项与退出条件

所有阶段先冻结对应契约，再实现能被用户或下一阶段实际使用的闭环。估算为一名熟悉 TypeScript/DSH 的开发者，未包含等待用户论文及领域审阅。

| 阶段 | 工作项 | 交付 | 退出条件 | 粗估工作日 |
|---|---|---|---|---|
| P0 兼容与骨架 | C01 宿主版本证据；C02 peer/exports；C03 bundle/preset；C04 最小工具；C05 作用域与两会话 | 可 pack 的最小插件、独立测试 profile | 真 rc.2 Web 启动并看到测试工具；不改默认 standard | 2–3 |
| P1 原文与账本 | D01 导入/版本；D02 block/range；D03 Unicode cursor；L01 journal/CAS；L02 resume/idempotency；L03 scope/owner | 文本导入、完整读取、重启恢复 | 超长行、100 页范围、外部变化、崩溃实验通过 | 4–6 |
| P2 主题与依赖 | A01 scanner schema；A02 全块扫描；A03 aliases/指代；A04 graph；A05 evidence验证；A06预算 | 完整影响清单及可复查依赖 | 合成 gold 发现任务可评测；失败块不被当成功 | 4–6 |
| P3 编辑与验证 | E01计划；E02候选稿；E03diff/回退；V01规则；V02模型复核；V03finish | 单文件主题修改闭环 | 缺项/误改/stale/unknown 阻止完成，原稿保留 | 5–7 |
| P4 上下文韧性 | X01 pre-step；X02 summarizer；X03预算；X04 /compact/overflow；X05 replay/fork；X06取消 | 可跨压缩与重启的任务 | 三条压缩路径的下一实际请求带正确 checkpoint | 3–5 |
| P5 原生文档扩展 | F01 PDF；F02提取验收；F03 DOCX；F04多文件LaTeX；F05格式渲染 | 论文常见格式完整流程 | 真实格式输出、页定位、编译/渲染和恢复通过 | 8–12 |
| P6 实际验收与发布 | T01本机Web；T02真实模型gold；T03真实论文；T04性能；R01pack/install/uninstall；R02文档/版本矩阵 | rc.2 验收报告和发布候选 | 下述质量及安装门槛满足，失败样本公开记录 | 5–8 |

总体粗估 **31–47 个工作日**。P0–P4 文本核心约 18–27 日；P5–P6 完整格式与验收约 13–20 日。验收发现召回缺陷、复杂 OCR 或公式保真问题时单列范围，不隐藏在时间估算内。

里程碑：M1=P0–P1 可读可恢复；M2=P2–P4 可跨压缩完成文本修改；M3=P5 原生格式；M4=P6 真实 Web 和质量验证。M2 不能宣称已交付原生 PDF/DOCX 完整编辑。

## 15. 测试策略与项目命令

### 15.1 确定性测试

测试外部行为：Unicode范围与cursor完整性、重叠覆盖去重、版本失效、evidence不匹配、补丁冲突、保护区域、不完整验收、幂等重试、journal中断、owner冲突、跨workspace拒绝、有限续作。以真实文本、边界和失败状态验证，不为简单字段映射重复实现断言。

### 15.2 DSH 集成和回放

测试 rc.2 exports、scope 与 HMR disposer、Native/PTC 下的工具行为（PTC仅在非严格兼容套件中）、model-visible输出预算、checkpoint实际入日志、默认pruner条件、取消、fork只读、resume重建、手动与自动压缩以及overflow即时重试。使用 FakeModel 回放可验证状态机，但标明不代表语义质量。

### 15.3 实际验收

按 [ACCEPTANCE_PLAN.zh.md](ACCEPTANCE_PLAN.zh.md) 在本机安装的 rc.2 运行独立测试 home/profile、真实 Web 页面和真实模型。保存输入、轨迹、最终候选稿、diff与gold评分。不能以函数隔离测试、headless成功或浏览器卡片显示成功代替整个Web链路。

### 15.4 待实现项目命令

```text
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration:rc2
pnpm test:replay
pnpm build
pnpm pack
pnpm acceptance:preflight
pnpm acceptance:web:rc2
pnpm acceptance:model:rc2
pnpm evaluate:gold
pnpm evaluate:report
```

以上命令在 P0/P6 实现后才可执行；当前没有 package.json，不能声称已运行或已通过。

## 16. 发布验收门槛

- 确定性不变量测试及安装、作用域、取消、恢复链路全部通过。
- 无 silent truncation；所有返回范围可续读还原，原文对象可校验。
- 压力、手动和 overflow 三类实际 request 全都保留正确任务状态和恢复路径。
- 原稿保留；外部版本变化导致 stale，而非覆盖或继续用旧检查。
- 真实模型 gold 套件按独立文档、多次运行评分。初始工程目标：修改召回 ≥98%、精确率 ≥99%、关键依赖通过 ≥98%、整篇成功 ≥90%；这些是发布目标，不是已测成绩。
- 对每个指标报告分母、按文档汇总与任务级成功率、置信区间。30次任务即使27次成功也不足以证明下限≥90%；报告必须保留不确定性。小样本只允许发布实验性版本。
- 压缩压力组的整体成功率不能有未解释的大幅下降；初始容忍目标为相对无压缩组不超过5个百分点，样本不足则记未知，不能定为无退化。
- 真实论文人工检查与gold合成套件分开；提取、OCR、公式/排版限制清楚列明。没有模型鉴权则真实模型验收未完成，不能降级后仍宣称发布门槛通过。
- 开发性工具卡与完整报告可用于首版；专用Web UI只有相应客户端验收后发布。

## 17. 风险与处理

| 风险 | 处理与观测 |
|---|---|
| rc.2 与分析源码接口不同 | 以本机导出与集成行为为准，单独兼容 Adapter，精确版本约束 |
| 扫全仍漏语义关联 | 第二遍依赖复查、独立模型复核、gold与失败样本评测；不宣称语义必然查全 |
| 上下文恢复导致请求超预算 | 小检查点、可回读证据、有界输出、shrink与请求占用验收；不足则停 |
| 扫描费用高 | 每块可复用但绑定目标/版本；限定调用预算；质量与费用共同报告 |
| 模型自评偏差 | 非摘要复核，gold独立评分；更换checker模型作为对照而非默认证明 |
| 提取顺序和公式信息损失 | qualityIssues阻止完成，保留页面依据，原生格式验收独立评分 |
| sidecar与DSH日志提交不同步 | requestId幂等与journalRevision、恢复收敛；模型可见历史保存原文本 |
| 专用工具被默认路径绕过 | strict preset能力限制与guards；advisory明确降低保证 |
| 外部编辑或多会话并发 | CAS、owner与版本失效；不静默重定位旧patch |
| 升级改变宿主行为 | 每个宿主版本独立loader与实测矩阵，未测版本明确拒绝 |

## 18. 本轮输出及后续执行顺序

本轮只输出 README、领域词汇、完整实施计划、本机验收计划和兼容证据。新项目原有 LICENSE 与 Git 历史保持；不提交、不推送、不安装、不改变现有 DSH 配置。

下一开发阶段从 P0 开始：先让最小打包插件在隔离 rc.2 Web 中真实加载，再建设原文与账本；不先写大量模型提示词而延后验证宿主可安装性。每阶段按退出条件报告实际执行、失败和待验收事项，实施计划与接口随已验证结果更新。

## 19. 数据迁移、安装回退与维护

每次发布包含插件版本、独立账本schemaVersion、已验收宿主矩阵与prompt版本。P0就定义schema v1读写；升级必须先做只读兼容检查和原文对象完整性检查，未来schema由旧插件明确拒绝，不猜测字段或丢弃关键记录。

迁移采用新generation写入、校验后切换指针，旧journal与对象保留；不原地覆盖原数据。迁移失败或取消保持旧generation可用。包版本回退不自动回退已升级数据；必须用验证过的旧generation恢复，报告哪些任务修改发生在升级之后，避免把它们静默丢掉。

安装回退分别处理bundle/preset配置和任务数据：卸载解除本插件效果，默认不删除任务账本；清理是显式维护操作，先列范围再按用户选定的任务删除。备份包含不可变对象、journal、schema与版本manifest；恢复后校验全部引用，缺对象的任务只能进入needs_attention。

第三方提取库、OCR和编译器记录版本与许可证；不把当前研究目录的完整源码、测试缓存或用户论文打入发布包。发布前检查package内容、ESM/types exports、peer依赖和许可证文件，执行从tgz安装的真实rc.2烟测。首版不自动发布到npm或更新用户现有default profile；实施阶段交付可检查的包和验收报告。
