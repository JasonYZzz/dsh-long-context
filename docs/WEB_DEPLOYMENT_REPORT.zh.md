# Web 插件本地部署与验收报告

日期：2026-10-14。版本：dsh-long-context 0.3.0-beta.1。范围：本地 3080 Web 安装、旧包卸载、重启及发布准备。按用户最后指示，未发布 npm、未上传 Release、未提交市场 PR。

## 实际安装与变更

使用本机原生 DSH 0.2.0-rc.2 的 plugin add 安装预构建 tgz 到 `/Users/admin/.dsh/profiles/web`。服务是原生 `dsh web --no-open --host 127.0.0.1 --port 3080`，工作目录 `/Users/admin`。只停止核对过的 3080 监听进程，其他服务保持运行。

卸载 `@dsh-context-pro/runtime` 和 `@dsh-context-pro/web`，移除对应 patch 节点及 standard 中的旧 engine 引用，恢复原生 `@deepseek-ai/dsh-compaction-basic`。原配置、依赖锁和进程信息已备份到私有 `.acceptance/deployment/20261014-web/`。旧会话、旧私有账本、其他插件与模型凭据保留；包管理器固定 pnpm 11.1.2，避免 Corepack 查询最新版本阻塞离线安装。

原生 CLI 将原 cordis.yml 展开内容规范化为 bundle/patch 组合。对备份和当前配置分别运行不启动服务的原生 dump-config，逐项比较有效配置：仅新增本插件三个入口，standard 中一处旧 compaction engine 改为原生 basic；其他有效配置完全一致。结果保存在私有 configuration-preservation.json。

客户端通过裸包名 dsh-long-context 被原生模块加载器发现，注册会话标题栏「长文工作台」。`/api/long-context` 通过原生 Connection 注册，继承鉴权与 Host/Origin 检查。工具进入当前 Agent 的 runMaintenance，继续使用原生工作区权限、任务 CAS 和所有权检查。

## 验收结果

| 验收项 | 证据和结果 |
| --- | --- |
| 构建、类型与 lint | TypeScript、ESLint、客户端 node --check 通过 |
| 自动测试 | 9 个测试文件、56 个测试通过，含 Web 参数、模式、工具隔离、维护锁与 CAS 透传 |
| 原生 tgz 安装 | preset、23 个 lc 工具、客户端模块发现与 Web snapshot 通过 |
| 实际 Web 入口 | 3080 显示按钮，Long Context 会话显示工作区及五个页签 |
| 插件管理 | 已安装列表含 dsh-long-context，详情显示 v0.3.0-beta.1、三个组件均运行中；旧两包不在已安装列表 |
| 标准模式限制 | 提示新建 Long Context，已有会话不自动切换 |
| Web 修改闭环 | 导入 → 精确替换任务 → 审查 → 计划 → 候选稿 → 复核 → 完成 → 报告导出 |
| 独立产物核对 | 80 处目标词替换；候选文件与外部预期逐字节一致，原稿未变，编辑模型调用为 0 |
| 页面恢复 | 重新加载浏览器后仍显示 completed_with_checks 任务 |
| 私有路径保护 | 导入 .dsh-long-context/manifest.json 被拒绝，未展示账本文本 |
| 响应式证据 | 1280×800、390×844 和本机 615px 窗口保存截图，沿用原生组件及主题变量 |
| 界面最终审查 | disposition: ship，无待修复项；结论仅覆盖本次局部界面 |
| 发布准备 | public/beta、repository/license、预构建文件、安装指南与独立市场 YAML 草案 |

合成验收文件在 `/Users/admin/dsh/ds-1/long-context-web-acceptance-20261014/`。自动化浏览器未完成原生目录选择器的新目录采用，因此明确选择已有 ds-1 工作区，在独立子目录生成合成文件，没有修改其他工作文档。工作区 long-context 账本新增一份文档和一条编辑任务。

本地证据：`evaluation/runs/web-live/result.json` 为浏览器操作和独立文件核对；`evaluation/runs/web-beta-suite-final.log` 为测试日志；`evaluation/runs/web-loader/result.json` 为 SDK 安装验收；`evaluation/runs/web-release/result.json` 为最终 tgz SHA256、安装内容校验及监听进程。这些运行数据默认 gitignored，不进入 npm 包。截图在 `.impeccable/review/`；市场截图仅保留本次合成任务的工作台区域。

## 限制与后续建议

历史隔离 SDK 验证不能算作本地安装，本轮才完成 3080 界面闭环。精确替换通过不等于语义或科学质量通过。真实 51 篇、17 原始中文与 34 英文、近五年且目标组参与的完整组合检索验收仍未完成，Crossref 不自动提供中文全文。30–100 逻辑单元与真实 PDF 页数必须分别核查。此前 30 页真实模型和 100 单元受控测试不能算作 100 页真实科学内容验收。

语义修改的影响项、依赖人工审查与生成 definitions 修订仍可通过原生 lc 工具对话调用，尚未全部做成结构化 Web 编辑控件。标准验收会话遭遇既有 MemSearch CLI 不支持 --default-collection 的不兼容错误；未改动该无关插件。Long Context 的文档工具闭环完成，不能据此宣称其他插件及全部聊天模式健康。

建议依次推进：修复 MemSearch 版本配套并复验 standard；补齐影响项、跨章依赖及 definitions 修订的 Web 控件；接入有权使用的中文全文渠道验证真实配额与归属；完成代表性 30/60/100 页内容及前章事实一致性审阅；用户要求发布后再推代码、npm beta 和市场 PR。兼容范围先保持精确 rc.2，其他 DSH 版本通过安装验收后再放宽。
