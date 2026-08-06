# 安全说明

## 报告问题

请优先使用 GitHub 仓库 Security 页面中的“Report a vulnerability”私密报告入口。请不要在公开问题中附带真实人物图片、未公开作品、Codex 凭据、Token 或本机日志。报告时提供最小复现步骤、版本和已脱敏错误即可。

## 当前安全边界

- Native Messaging Manifest 只允许当前发行渠道对应的 VisualForge 扩展 ID；开发渠道使用固定开发 ID，Chrome Web Store 渠道必须显式提供正式 ID，缺失时禁止产包。
- 扩展与 Host 消息具有外层协议结构校验。
- 图片采用系统生成的 ID 和受控临时目录，不使用用户文本拼接路径。
- 图片分块限制大小，并校验总字节数与 SHA-256。
- 生成输出拒绝符号链接、目录外路径、非普通文件、超过 20MB 或图片签名不符的文件。
- 网页图片按钮脚本在普通网页中运行，只在页面本地识别候选图片；框选脚本仍只在用户触发时通过既有 HTTPS 页面权限动态注入。
- Host 不提供公网 HTTP 服务，不上传遥测。
- Host 在 macOS 上解析实际 Codex 可执行文件，并记录 `codesign` 签名状态、Team ID 和 Identifier；当前只把 OpenAI Team ID `2DC432GLL2` 标记为可信。自定义或其他来源路径不会被硬阻止，但诊断和命令行会显示来源风险。
- 诊断与真实生成会记录 Codex 版本、实际路径，以及本次 imagegen `SKILL.md` 的解析路径和内容 SHA-256；生成任务与 Manifest 的 provider parameters 保留同一溯源。

扩展权限包括 `sidePanel`、`contextMenus`、`scripting`、`storage` 和 `nativeMessaging`，并需要普通 HTTPS 页面访问权限。粘贴图片通过用户主动触发的系统 `paste` 事件接收，不申请 `clipboardRead`。权限理由与用户数据边界见 `PRIVACY.md`；任何新增权限必须同时更新 Manifest、隐私说明和商店披露。

## 已知限制

- Chrome Web Store 尚未发布，0.5.8 使用固定开发渠道扩展 ID 和“加载已解压的扩展程序”；正式商店版必须由商店 Public Key 反推并绑定正式 ID。
- macOS 包使用 Developer ID、Hardened Runtime、Apple 公证与 Staple。Windows／Linux 0.5.8 包由 macOS 交叉构建，目标平台代码签名与真机连续验收状态以对应 Release 为准。
- 当前 Host 只保留 Node V8 运行所需的最小可执行内存权限；任何新增 entitlement 都必须先有独立运行证据。
- 正式安装默认只写 Google Chrome Stable，测试浏览器必须显式启用开发选项。
- 异常中断可能在 `~/Library/Application Support/VisualForge/` 留下文件；Host 启动时会清除超过 24 小时的临时数据，设置中的“清空全部本地数据”会清除用户文件并保留 Host，显式卸载 `--delete-data` 会删除整个 Support 目录。
- 原始 Host 错误只写入 stderr，不建立持久日志；报告问题前仍应检查并脱敏本机路径。
- OpenAI 若更换正式签名 Team ID，可信列表必须经过新版官方发行物核验后更新；不得仅因路径名称包含 Codex 或 OpenAI 就判定可信。

## 支持范围

界面支持 Google Chrome Stable；Native Host 提供 macOS Universal、Windows x64 和 Linux x64 包。使用状态和未完成的目标系统验收边界以 [Releases](https://github.com/dososo/visualforge/releases/latest) 为准。
