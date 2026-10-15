> 2026-10-15：当前版本已更新为 0.4.0-beta.1。请以[通用优化执行报告](GENERAL_OPTIMIZATION_EXECUTION_REPORT.zh.md)和[README](../README.md)为准；以下为历史验收记录。

> Web 0.3.0-beta.1 的本地安装与界面验收见 [Web 部署报告](WEB_DEPLOYMENT_REPORT.zh.md)。此前核心优化见 [0.2.0 优化执行报告](OPTIMIZATION_EXECUTION_REPORT.zh.md)。以下保留旧版验收历史，不能用于判断新版已经通过完整需求。

# 开发状态

更新日期：2026-10-14（Asia/Shanghai）。本节为 `0.1.0` 的历史状态，定位为实验性文本核心，整份实施计划尚未全部完成。

## 当前代码

- Node ESM、TypeScript strict、锁定依赖、Vitest、ESLint、可打包 exports 与独立 bundle/preset。
- 不可变 UTF-8 原文、内容 hash、Unicode 码点块与精确定位、分页 cursor、词法搜索。
- 持久 JSON journal、hash 链、workspace 锁、revision CAS、requestId 幂等、owner 隔离和重启恢复。
- 全块主题扫描、结构化响应和精确 evidence 校验、alias 触发复扫、依赖记录、调用预算和输入/输出审计。
- 逐项补丁、重叠与保护区域检查、候选稿持久准备/提交、hash 保护回退、失败候选的修订和候选历史。
- 结构检查、逐块模型复核、严格完成门槛、完整报告导出。
- rc.2 scoped 工具、每 Agent 工具限制、pre-step checkpoint、有界终止纠正和继承 BasicCompactionEngine 的摘要扩展。
- 固定 100 页样本生成、字符串 gold 评分、任务级报告和 Wilson 区间。

## 已执行的验证

已运行类型检查、lint、核心单元测试、从 tgz 安装的真实 rc.2 loader/工具集成，以及受控 provider 的压缩回放测试。集成套件启动真实 DSH Web 运行时并创建 preset 会话，不以自建服务器替代宿主。

受控机制测试检查实际请求：压力压缩、手动压缩、provider 确认的受控 overflow 后即时重试，均保留当前任务 checkpoint；随后通过真实 ToolRuntime 完成文本扫描、候选稿、验证、完成和报告导出。还检查了长行/Unicode 续读、跨工作区拒绝、owner 冲突及 strict preset 不暴露 shell。

本地证据为 `evaluation/runs/preflight/`、`evaluation/runs/web-loader/` 和 `evaluation/runs/mechanisms/`。这些目录包含本机运行数据，默认不提交。测试 provider 仅供确定性机制验证，不能用于宣称真实模型质量通过。

## 尚未完成

- P5：原生 PDF 分页提取与异常验收、DOCX 结构写回与渲染、多文件 LaTeX 分阶段提交、可选 OCR。
- P4/P6 的完整矩阵：真实 provider overflow、完整 Web 用户操作轨迹、所有取消/HMR/崩溃组合、格式编译与渲染、性能基线及发布级安装/卸载矩阵。
- P6 的真实质量：已授权真实模型、独立 gold 多次评分、至少 3 篇真实论文的领域审阅。
- 未来 schema 的 generation 迁移、完整备份/清理维护命令尚未提供；当前会拒绝未知 schema。

真实模型脚本在缺少隔离认证 profile 时记录 `not-run`。尚未取得真实论文副本，也没有发布质量指标、费用节省或任意论文准确率结论。当前没有发布到 npm，未改变用户原有默认 profile。
