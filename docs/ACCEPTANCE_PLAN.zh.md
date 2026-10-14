# 本机 DSH Web 0.2.0-rc.2 实际验收计划

> 开发进度更新（2026-10-14）：实验性文本核心及部分 rc.2 安装/机制验收已有实现；本文保留原始计划与历史核查记录，当前交付和未完成项以 [开发状态](DEVELOPMENT_STATUS.zh.md) 为准。

计划更新：2026-10-14（Asia/Shanghai）。开发顺序见 [实施计划](IMPLEMENTATION_PLAN.zh.md)。本文的 Web 与模型测试尚未执行；已完成的本机版本核查单独记录在 [兼容基线](DSH_COMPATIBILITY.zh.md)。

## 1. 验收环境与隔离

本机已安装 `@deepseek-ai/dsh@0.2.0-rc.2`。当前 PATH 未发现 dsh 命令，可用已经验证的本地 CLI 入口启动：

```sh
node /Users/mac/.npm/_npx/1e7f6d9597241db0/node_modules/@deepseek-ai/dsh/lib/bin.js --version
```

已执行输出为 `0.2.0-rc.2`，这是实际版本证据，不代表插件已经兼容。本机 Node 版本核查为 `v26.5.0`。缓存目录可能被 npm 清理；验收脚本优先解析项目锁定的 DSH 开发依赖入口，缺失时寻找版本匹配的已安装入口，不自动用 npx 下载最新版本。

测试使用：

- 仓库：`/Users/mac/dsh/dsh-long-context`。
- 测试 DSH home：`/Users/mac/dsh/dsh-long-context/.acceptance/dsh-home`。
- 测试 profile：`lc-acceptance`，从本机 shipped web 模板生成。
- 对照 profile：`lc-baseline`，同版本默认 standard，不加载插件。
- 插件 preset：`long-context`，在 Web 内实际选择。
- 测试工作区：`/Users/mac/dsh/dsh-long-context/.acceptance/workspace`。
- 测试监听：`127.0.0.1:3088`；若占用使用 `--port 0` 并记录实际端口。
- 报告根：`evaluation/runs/<run-id>/`，与用户原论文及原 DSH home 分离。

不改 `/Users/mac/.dsh` 的 default profile，不以 npm cache 中修改库代码代替插件安装。设置、模型route、sandbox/approval、reasoning、输出上限在两个测试 profile 中逐项对齐。测试 home 使用标准 DSH 认证入口配置；可使用进程中已授权的凭据引用，不导出或自动复制原 home 的密钥文件。缺少可用模型鉴权时，记录 `live-model-not-run`，不能当作真实模型通过。

### 1.1 待实施启动步骤

P0 实现 `acceptance-preflight` 后首先确认实际 CLI、DSH/Cordis 版本、端口与目录。以下命令是 rc.2 已核实旗标组成的计划示例，必须在开发阶段执行并保存结果：

```sh
DSH_HOME=/Users/mac/dsh/dsh-long-context/.acceptance/dsh-home \
  node /Users/mac/.npm/_npx/1e7f6d9597241db0/node_modules/@deepseek-ai/dsh/lib/bin.js \
  --profile lc-acceptance --from-default-profile web --dump-config
```

核查该启动模式是否创建了自定义 profile；如果 dump-only 模式不负责初始化，preflight 使用 shipped profile boot 接口或正常 Web 启动初始化，保留完整证据，不手写未经验证的 profile manifest。

插件构建和 pack 后，通过 `dsh plugin --profile lc-acceptance add <本次产生的tgz绝对路径>` 安装；tarball 路径以本次 pack 输出为准。bundle 选中/激活方式在 P0 用 rc.2 管理器和 manifest 验证，不能假设安装等于激活。然后启动：

```sh
DSH_HOME=/Users/mac/dsh/dsh-long-context/.acceptance/dsh-home \
  node /Users/mac/.npm/_npx/1e7f6d9597241db0/node_modules/@deepseek-ai/dsh/lib/bin.js \
  --profile lc-acceptance --patch /Users/mac/dsh/dsh-long-context/bundle/acceptance.patch.yml \
  --host 127.0.0.1 --port 3088 --no-open
```

该 acceptance.patch.yml 在 P0 创建，必要时由生成器根据本次 bundle 配置生成。`--host/--port/--no-open` 已在本机 `dsh-web-app/lib/startup.js` 确认存在，实际启动行为仍须验收。

Web 必须由正常 dsh profile 启动，不能用测试自建 server 替代。浏览器进入实际地址、创建测试 workspace/session、选择 long-context 和目标模型，再走用户会执行的工具流程。优先用可自动化浏览器运行确定步骤，失败时保留日志和截图，不能只看最后一张页面。

## 2. 三层验收

| 层次 | 验证什么 | 不足以证明什么 |
|---|---|---|
| L1 安装与运行 | 真rc.2 loader、Web、工具注册、scope、卸载 | 论文修改正确 |
| L2 状态与机制 | 原文完整、journal、压缩/重启恢复、CAS和guard | 模型查全关联 |
| L3 真实质量 | 真模型主题修改、gold评分、实际论文复核 | 未测论文和模型普遍可靠 |

FakeModel 和录制回放可用于 L1/L2 稳定复现。L3 必须调用真实模型；真实请求通过当前 DSH route 发送，模型版本、参数和所有辅助请求均归档。无模型层的通过不能抵消质量层未执行。

## 3. 基础功能与恢复验收矩阵

| ID | 场景与动作 | 必须观测的通过条件 |
|---|---|---|
| ENV-01 | pack本项目，安装到lc-acceptance，启动实际Web | profile选中bundle；工具在实际session可见；peer解析同实例 |
| ENV-02 | 创建两个workspace和session | A无法读B账本或原文；任务owner不串；默认standard保持原配置 |
| ENV-03 | 卸载、重启、重新安装 | listener/guard/tool解除；无重复注册；数据保留策略正确 |
| ENV-04 | HMR卸载时有扫描/验证请求 | 已接受操作完成或明确取消；没有悬挂写锁或后台重复提交 |
| DOC-01 | 100页、3000行带页码TXT/MD，顺序读取 | 所有原文范围可还原，覆盖区间无缺口；total计数准确 |
| DOC-02 | 长行超过2000字符，主题在2501及更后位置 | lc_read character cursor返回尾部，hash与原稿一致 |
| DOC-03 | 中文、emoji、跨块句子、超长表格 | 不拆坏Unicode；超长结构有完整续读或明确异常 |
| DOC-04 | 上传100页原生文本PDF，执行lc_import | 不把附件handle算正文；页/块和提取异常有记录 |
| DOC-05 | 双栏/扫描/公式密集PDF | 质量问题真实反映，缺OCR或无法解析时不得标全文完整 |
| DOC-06 | DOCX段落和表格、LaTeX含引用 | 定位精确，候选副本可渲染/编译，失败范围明确 |
| TOP-01 | 跨页术语、别名、无关键词改写、代词 | gold影响项召回可计；词法搜索零匹配不结束扫描 |
| TOP-02 | 同词历史引用、负例、他人观点 | keep有记录；没有为统一主题误改干扰项 |
| TOP-03 | 根定义改变牵连方法/实验/讨论/附录 | 依赖引起复查；未解决关系阻止lc_finish |
| EDIT-01 | 单文件多处主题修改 | patch逐项绑定影响项，原稿保留，候选稿diff可查 |
| EDIT-02 | patch匹配错误或重叠 | 全部校验后才写；错误不产生半个正式候选稿 |
| EDIT-03 | 扫描后用外部编辑器改源文件 | old revision/plan失效，旧cursor/patch明确拒绝 |
| EDIT-04 | 模型尝试generic edit/write或shell绕行 | strict preset能力和monotonic guard生效；候选结果仍经版本检查 |
| STATE-01 | 关闭Web再恢复session和task | 状态/原文/下一动作从journal重建，不靠模型猜测 |
| STATE-02 | journal写入中和候选提交中强制终止测试进程 | 重启后收敛；临时稿不伪装正式结果；无重复patch |
| STATE-03 | 工具已提交但返回丢失，重试requestId | 返回同一结果，不再次计费扫描或写候选稿 |
| STATE-04 | fork、双会话争用、明确接管 | 默认fork只读；CAS与owner冲突可解释；接管有记录 |
| STOP-01 | 模型提前结束但仍有影响项 | 任务状态不完成；有界steer纠正，最多2次无进展后停 |
| STOP-02 | 用户取消、模型超时、预算耗尽 | 任务保留可恢复状态，不无限续作、不标成功 |
| VERIFY-01 | 候选稿遗漏/误改/未解决依赖 | lc_finish拒绝，报告指出位置和检查范围 |
| VERIFY-02 | 外部改候选稿后复用旧验收 | 旧VerificationRecord失效，重新检查 |

涉及 v0.2 格式能力的项在 P5/P6 完成，不得用 v0.1 未支持格式强行通过。

## 4. 压缩恢复验收：必须检查实际请求

每次压缩前固定 taskId、journalRevision、基线/候选版本、未完成项和checkpoint hash。保存压缩前后 surface 的相关seq，核查下一次实际发送给provider的模型历史，不仅检查界面摘要。

| ID | 触发方式 | 必须检查 |
|---|---|---|
| CTX-01 | 未压缩正常步骤 | checkpoint按变化提供；无变化不无界重复；task revision正确 |
| CTX-02 | 真实压力达到threshold，触发prune+summary | 关键状态在落地summary；下一请求能读回原始证据；没有把prune中部当完整依据 |
| CTX-03 | 在实际Web执行 /compact | 手动summary包含当前任务检查点，下一消息恢复同一账本 |
| CTX-04 | provider确认context overflow后的即时retry | 同一个retry请求携带有效checkpoint；receipt过期范围回读；恢复次数有界 |
| CTX-05 | 一个任务经历3次以上压缩 | 状态与证据hash不漂移，候选版本及未决统计保持可核查 |
| CTX-06 | 压缩summarizer失败、输出上限、取消 | 失败不消灭外部账本；不能误写“恢复成功” |
| CTX-07 | checkpoint与summary合计不满足shrink | 明确失败/预算调整；不能丢mustPreserve以强行缩短 |
| CTX-08 | 降低pruner/spill cap或小模型窗口 | 插件适配结果预算或明确拒绝；不静默删掉正文范围 |
| CTX-09 | runtime context关闭、含{{...}}的论文 | pre-step方案不依赖新版required字段；正文模板字符串不引起变量插值 |

压力测试通过独立 acceptance overlay 调低阈值触发，记录为人工压力条件；正常默认窗口下的结果单独记录，不混称默认触发。要保证上下文预算仍合法，不用headroom配置错误制造“已经压缩”的假象。

overflow可先用受控FakeModel返回DSH识别的错误验证L2；L3再选允许配置的小窗口route或受控请求大小验证真实provider行为。无法稳定获得真实overflow时报告该项未测，不能把模拟错误算作真实API通过。

人工提高pressure只追加有来源的固定测试内容，不能把它误标为论文证据，也不能访问用户其他会话用于填充。

## 5. 100页质量评测样本与任务

### 5.1 可判定的gold套件

先建立10份独立长文，每份约100页，以Markdown/LaTeX源和对应可渲染PDF生成。页数之外记录词数、Unicode长度、实际token/usage、块数和有效主题范围。金标准不放进模型工作区或prompt；评测器独立持有gold。

每份包含：主题定义、别名与同义句、跨块/跨章节指代、公式和图注、正文与附录关系、历史引述、负例、无关同词干扰。必改和不可改项由生成规则与独立人工复核确定。模型推断出来的新影响项只能记待审，不能自动扩充gold来提高分数。

任务类型：

1. 术语统一及别名同步，保留历史引用和负例。
2. 定义或适用范围改变，更新相关方法描述、实验解释、讨论与结论。
3. 数值/阈值改变，检查表格、图注、摘要及附录对应关系。
4. 表达优化，保持事实、公式、引用和逻辑关系不变。
5. 科学依据不足的主题变更，预期结果是识别证据缺口，而非编造完成。

首轮每份选一个明确gold任务，三个独立重复运行；得到每个条件30次任务。任务类型在10份中平衡分布。扩大样本或任务类型必须预先记录新增条件，不能只补有利案例。

### 5.2 对照条件

| 条件 | 组成 | 目的 |
|---|---|---|
| A 默认 | 同版本DSH Web standard，同模型同参数 | 测默认机制的基线 |
| B 插件 | 同版本Web long-context，同模型同参数 | 测插件整体改善与费用 |
| C 全原文参考 | 同模型，完整原文可稳定保留的窗口/流程 | 分离上下文丢失与模型理解问题；做不到则明确缺失 |

A/B分别测试正常历史和强制压缩历史。同一文档、任务、模型参数配对，不把换强模型的成绩归因于插件。C只在实际窗口可容纳全文时使用，不能一边截断一边宣称全文参考。

每个条件30次任务只是首轮实验规模：没有跨样本/版本保证。发布报告显示分母和置信区间，不因平均高分宣称“都能准确修改”。

### 5.3 真实论文

另外选至少3篇不同结构、使用权明确且用户允许处理的真实论文：普通正文、公式/引用密集、跨章节/附录密集各一篇。用副本和真实可编辑源；原文未提供前不编造真实论文结果。

每篇完成至少一个跨页主题任务，领域审阅检查定义、论证、实验解读与结论；原生格式还需渲染/编译检查。真实论文没有事先完整gold时，报告为人工检查案例，不能并入严格gold成功率。用户提出的科学修改若证据不足，应保留未完成状态并列所需依据。

## 6. 指标与评分

主要指标是整篇任务成功率。并行报告以下指标：

- 修改召回：正确修改的gold必改位置 / 所有gold必改位置。
- 修改精确：正确且必要的改动 / 所有改动。
- 依赖一致性：gold关键依赖检查通过数 / 全部检查数。
- 整篇成功：所有必改项正确、无误改、无关键依赖矛盾、格式检查通过；缺项直接该任务失败。
- 保真：无依据事实改动、数值/公式破坏、引用损坏分别计数。
- 覆盖：read/topicReviewed/changeResolved/verified四类独立统计；不当作准确率。
- 韧性：按压缩次数、重启和重试分组的质量及失败路径。
- 成本：conversation/scanner/verifier/compaction各自usage、请求数、缓存和墙钟耗时；价格未知时只报usage。

精确字符串任务可程序评分；语义改写由不知道A/B标签的审阅者评分，必要时另一审阅者处理分歧。不得由执行修改的模型自评作为唯一gold得分。

对含多个位置的文档，以文档/任务为统计单位计算置信区间，不能把同篇内几十处修改当几十份独立样本。固定版本、prompt、配置及样本后再比较；重跑全部预定义案例，不只重跑失败或成功案例选最好结果。

发布目标见主计划第16节。性能和质量门槛未满足时标实验性版本，给出实际限制与后续修复，不把所有结构测试通过当产品任务成功。

## 7. 性能与资源观测

在本机记录文档导入、范围读取、检索、checkpoint生成的P50/P95，以及100/500页扩展样本的峰值内存、journal大小和恢复时间。模型耗时和纯本地处理耗时分开，文件页数与字节/token负载同时记录。

第一轮建立本机基线后冻结回归预算：相同固定样本与硬件下，本地关键操作P95不应出现未解释的20%以上回退；不能以改变分块或丢弃正文换取速度。大文档超过配置上限时返回能力限制，不OOM或假装导入完整。

Web操作测试包含：真实加载工具结果、分页、修改报告、断开后恢复；不用只测Host函数的结果宣称Web可用性。默认generic卡足够首版，但它必须正确展示失败、截断/续读和状态。

## 8. 必须归档的证据

每个run保存：

```text
evaluation/runs/<run-id>/
  environment.json       CLI/DSH/Cordis/Node、系统、模型身份
  config-sanitized.json  插件配置、preset、route、输出/压缩预算
  case.json              样本hash、任务、条件、seed与限制
  input-manifest.json    原文版本、提取器、gold引用（不含模型可访问答案）
  plugin-journal/        任务状态和辅助模型请求记录
  dsh-session/           实际session导出与request/surface轨迹
  artifacts/             候选稿、diff、修改/验证报告
  screenshots/           关键Web状态；避免凭据与个人内容
  score.json             gold位置和整篇评分、分母、失败原因
  timing.json            本地/模型时间和usage
  verdict.md             passed/failed/not-run及限制
```

配置和日志导出不包含token、cookie或API key。保留原始论文与请求的授权本地副本用于复现；默认不上传报告。插件schema版本、package tarball hash和安装锁文件需要记录，防止“同版本名字不同代码”混用。

## 9. 退出、清理与最终报告

通过测试启动脚本记录的PID停止自己的Web进程，不按名称杀掉所有DSH；回到用户原环境。测试profile与数据先保留到验收报告复查完成；清理只作用于本次`.acceptance`目录和本次创建的run数据，不能删除用户`~/.dsh`。

最终报告列出：已通过ID、失败ID、未执行ID、实际模型/版本、A/B/C成绩及置信范围、费用/耗时、失败原文定位、兼容版本、原生格式限制。插件安装、L2机制与L3质量分别给结论。

只有实际完成这些步骤后，才能说“已在本机DSH Web 0.2.0-rc.2验收”；目前仅把这套验收写入实施计划。
