# VisualForge 最小安装指南

## 三步安装

### 1. 下载一个适合你系统的包

打开 [VisualForge Releases](https://github.com/dososo/visualforge/releases/latest)：

- macOS：`VisualForge-0.5.8-macos-universal.dmg`
- Windows 10／11 x64：`VisualForge-0.5.8-windows-x64.zip`
- Linux x64：`VisualForge-0.5.8-linux-x64.tar.gz`

使用前请先安装并登录 Codex。VisualForge 使用你当前登录的 Codex，不需要 API Key。

### 2. 安装连接组件和 Chrome 扩展

**macOS**

1. 双击 DMG，再双击 `Install.command`。
2. 解压 DMG 里的 `VisualForge-extension.zip` 到一个不会移动的文件夹。

**Windows**

1. 解压下载包，右键 `Install.ps1`，选择“使用 PowerShell 运行”。
2. 解压包内 `VisualForge-extension.zip` 到一个不会移动的文件夹。

**Linux**

1. 解压下载包，在目录中运行 `./install.sh`。
2. 解压包内 `VisualForge-extension.zip` 到一个不会移动的文件夹。

然后在 Chrome 中：

1. 打开 `chrome://extensions`。
2. 开启右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择刚才解压出的扩展文件夹。

### 3. 检查连接

点击 Chrome 工具栏中的 VisualForge，打开侧边栏；进入“设置”，点击“重新检查连接”。顶部显示“Codex 已连接”即可使用。

## 第一次使用

1. 上传或粘贴一张参考图；也可以在普通 HTTPS 网页图片上点击 VisualForge。
2. 查看 VisualForge 对画面的理解。
3. 如需替换人物或商品，选择“换成我的”并添加素材；直接生成也可以。
4. 选择生成单张、套图或宫格，完成后逐张查看并选定最终作品。

## 更新

下载新版本并重新运行安装入口，然后到 `chrome://extensions` 删除旧扩展、重新加载新版解压目录。浏览器中的作品不会因为覆盖安装连接组件而删除。

## 卸载

- 只卸载本地连接：VisualForge 设置 → “卸载本地连接组件”。作品和人物素材会保留。
- 删除扩展：打开 `chrome://extensions`，找到 VisualForge，点击“移除”。
- 彻底删除本地数据：先在 VisualForge 设置中选择“清空全部本地数据”，再执行上面两步。

遇到问题请查看[支持页](https://dososo.github.io/visualforge/support.html)。
