# VisualForge 隐私说明

VisualForge 采用本地优先设计。

- 扩展会在普通网页中本地识别适合捕获的图片区域，以显示 VisualForge 按钮；在用户点击之前，不会保存图片、来源网址或把页面内容交给生成服务。
- 用户点击捕获、分析或生成后，VisualForge 会处理用户选择的图片、来源网页网址与标题、用户填写的要求和所选主体图片，用途仅限完成该次视觉分析、生成、重试、保存和来源追踪。
- 参考图、视觉分析、生成参数、来源信息与结果默认保存在 Chrome IndexedDB。网页捕获刚完成、侧边栏尚未读取时，待处理图片 Data URL、来源网址与标题会暂存在 `chrome.storage.local`；当前标签页编号和右键捕获目标元数据会短暂保存在 `chrome.storage.session` 与扩展后台内存。捕获目标被读取或过期后立即删除；异常中断时由“清空全部本地数据”一并删除。
- 用户主动在侧边栏按下系统粘贴快捷键时，扩展只接收这次粘贴事件中的图片；扩展不申请剪贴板读取权限，不会后台读取剪贴板。
- 只有用户主动点击分析或生成后，Native Host 才会在本机启动 Codex App Server，并通过 `~/Library/Application Support/VisualForge/` 传递用户本次选择的图片、提示词和生成结果。相关内容会发送给用户当前登录的 Codex／OpenAI 服务，以完成本次分析或图像生成；OpenAI 的处理适用用户当前账户与 OpenAI 条款。
- VisualForge 自身不建立中心服务器，不出售、出租或用于广告定向处理用户数据。
- 成功任务会在输入使用完毕、输出最后一个分块传回后删除登记图片；异常退出时可在设置中同时清理浏览器与 Native Host 文件。
- 扩展不读取、复制或保存 Codex 登录凭据、Token 或 API Key。
- 项目没有中心服务器、账号系统、遥测和崩溃数据上传。
- 用户可以在设置中执行“清空全部本地数据”，同时清理 IndexedDB、`chrome.storage.local`、`chrome.storage.session`、扩展后台临时状态和 Native Host 用户文件。浏览器与 Native Host 会分别清理并分别反馈结果，不会把部分成功误报为全部成功；浏览器数据清理完成后立即撤回同意状态、关闭网页图片按钮并返回首次同意界面。

## 权限用途

- 网页访问：在普通 HTTPS 页面中显示图片按钮，并在用户点击后捕获当前目标图片。VisualForge 不读取浏览历史列表，也不在 HTTP 页面注入。
- `sidePanel`：承载创作与作品界面。
- `scripting`：仅在用户触发框选或需要恢复当前网页按钮时运行已随扩展打包的脚本。
- `storage`：保存开关、当前捕获状态和本地作品索引。
- `nativeMessaging`：连接本机 VisualForge Host 和 Codex App Server。
- `contextMenus`：提供右键捕获当前图片的替代入口。

## 用户控制与删除

- 网页图片按钮默认开启，可随时在设置中关闭。
- 来源网址保存可在设置中关闭。
- 浏览器内作品、项目、人物／商品素材、设置与待处理捕获可在设置中清空；单个作品、套图和主体也可分别删除。
- Native Host 用户文件位于 `~/Library/Application Support/VisualForge/`。“清空全部本地数据”会保留运行所需的 `bin` 目录并删除其余用户数据；设置中的“卸载本地连接组件”会移除程序与 Chrome 连接配置，并保留浏览器作品、人物和设置。只有用户明确选择命令行 `--delete-data` 时才删除整个 VisualForge Support 目录，包括中断安装残留。

Codex 与图像生成能力本身受用户当前 OpenAI／Codex 账户条款约束。

隐私问题可联系：blteam2026@outlook.com。

## Chrome Web Store Limited Use

VisualForge 对从 Chrome API 获得的数据的使用与传输，遵守 Chrome Web Store 用户数据政策及其 Limited Use 要求：数据只用于提供或改进用户明确可见的网页图片捕获、视觉分析、生成与本地作品管理功能，不用于广告、信用评估、数据经纪或与产品核心功能无关的用途。
