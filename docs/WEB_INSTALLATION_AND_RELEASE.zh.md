# Web 安装与发布准备

版本：0.3.0-beta.1。目标：原生 DeepSeek Harness 0.2.0-rc.2 / Node ≥22.13；本机 Node 24.19.0。当前仅本地预构建 tgz 安装，尚未发布 npm，也未提交社区市场 PR。

## 本地安装

```sh
pnpm install --frozen-lockfile
pnpm typecheck && pnpm lint && pnpm test && pnpm build
pnpm pack --pack-destination .acceptance
dsh plugin --profile web add /absolute/path/dsh-long-context-0.3.0-beta.1.tgz
```

停止对应 Web 进程后重新运行 `dsh web --no-open --host 127.0.0.1 --port 3080`。重新加载页面；选择工作区，新建 Long Context 会话，发送首条消息，再打开标题栏「长文工作台」。旧 standard 会话不会切换。文档路径须在工作区内；候选稿必须使用新路径。操作进行时会话被原生 maintenance 锁定；取消请求后刷新权威状态，不应假定写入被撤销。

包内已包含 dist、client、bundle，不依赖安装时构建。dsh.bundle 安装 host、preset 和裸包名 Web 入口；dsh.client 声明平台及原生 UI 依赖。根入口从 agent 改为 Web，直接导入 agent 的旧调用方请使用 `/agent`；headless 使用 `bundle/headless.patch.yml`，Web 可选 connection peer 在 headless 中不要求激活。

## 当前机器的替换

已备份 web profile 的配置与依赖锁；卸载 @dsh-context-pro/runtime、@dsh-context-pro/web，删除它们在 patch 中的运行入口，并恢复标准模式的原生 dsh-compaction-basic。历史会话和旧插件私有数据保留；其余插件与模型凭据保留。备份及运行日志位于本地私有 `.acceptance/deployment/20261014-web/`，不进入 npm 包。最终验收与实际安装包哈希见 WEB_DEPLOYMENT_REPORT.zh.md。

本机为长文生成配置了本地 LibreOffice 渲染器和字体；这些绝对路径不会随 npm 安装自动配置。其他机器需要自行指定 rendererExecutable / rendererFontconfigFile 并验证真实 PDF 页数。

卸载新插件：`dsh plugin --profile web remove dsh-long-context`，随后重启对应服务。卸载保留工作区账本。恢复旧 profile 前必须停止服务并检查备份后新安装的插件；不要直接覆盖期间其他更改。

## npm 发布（待用户再次要求发布后执行）

1. 确认当前代码已推送到 repository 指向的仓库，文档、截图与能力声明一致。
2. 重新运行检查并打包；核查包内没有凭据、私有账本和测试工作区。
3. 登录 npm，核查 dsh-long-context 包名归属和发布权；若包名被他人占用，应改为本人 scope，并同步所有 bundle、客户端模块 ID 和安装文档。
4. 显式发布 beta：`npm publish .acceptance/dsh-long-context-0.3.0-beta.1.tgz --access public --tag beta`。不可覆盖已发布的同版本。
5. 在干净的原生 Web profile 验证 `dsh plugin --profile web add dsh-long-context@beta`，再次完成界面闭环；通过后才标记 npm 安装可用。

publishConfig 已声明 public/beta，repository、homepage、bugs、MIT 和关键词已补齐。本轮没有执行上述发布命令，npm 安装命令仅为发布后的操作说明。

## 社区市场收录准备

dsh-market 与 awesome-dsh-plugin 共用精选列表。按[当前贡献指南](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)，向 awesome-dsh-plugin/awesome-dsh-plugin 提交一个 `data/plugins/JasonYZzz__dsh-long-context.yml`，不要手改自动生成的 README。草案已保存至 `docs/marketplace/JasonYZzz__dsh-long-context.yml`。分类 docs，双语一句话描述，无未经验证的科学质量声明。

[dsh-market 自述](https://github.com/dsh-market/dsh-market/blob/main/README.zh.md)说明它是市场应用、列表来自上述仓库。它们是社区收录渠道；遵循官方 DSH 插件协议和 npm 安装方式不代表官方认证。

发布代码并满足仓库年龄、活跃维护、dsh-plugin topic、有效 dsh.bundle 后再提交草案。npm 并非收录必需；若未发布 npm 且无法从源码安装，需要先上传预构建 GitHub Release tgz 并添加确实可下载的 tarball 字段。本轮未创建外部 Release/PR。截图声明使用根目录 screenshots.json；截图只包含合成验收数据，不含密钥或历史对话。市场合并和站点构建完成后才能声明已收录。

## 能力边界

Web 是现有核心的操作入口。组合检索可冻结五年窗口、课题组身份与参与证据、原始语言和 51 篇配额，仍需授权中文全文来源；不足会报告缺额。逐页生成支持 30–100 逻辑单元和配置后的物理页数核对；完整科学质量、100 页真实模型生成和架构联动尚未完成独立验收。扫描/复核/生成会使用所选模型并产生调用成本。
