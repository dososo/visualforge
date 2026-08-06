<div align="center">

<img src="apps/extension/assets/brand/visualforge-silver-proof-mark.png" width="104" alt="VisualForge" />

# VisualForge 风格铸造

**中文** · [English](README.en.md)

看到喜欢的图片，把它变成你的作品。

[![License](https://img.shields.io/badge/许可-Apache%202.0-C7442E.svg)](LICENSE)
[![Chrome](https://img.shields.io/badge/Chrome-116%2B-273E4F.svg)](INSTALL.md)
[![Platforms](https://img.shields.io/badge/Host-macOS%20%7C%20Windows%20%7C%20Linux-2E6B4F.svg)](https://github.com/dososo/visualforge/releases/latest)
[![Version](https://img.shields.io/badge/版本-0.5.8-8A8378.svg)](https://github.com/dososo/visualforge/releases/latest)
[![Codex](https://img.shields.io/badge/Powered%20by-Codex-222220.svg)](#它如何工作)

</div>

> VisualForge 是一个接入本机 Codex 的 Chrome 侧边栏插件。你在网页上看到喜欢的视觉，可以直接捕获；VisualForge 会理解它的构图、光影、色彩、材质、镜头与氛围，再把人物或商品换成你的素材，生成单张作品、成套写真或宫格图。

<div align="center">
  <img src="assets/screenshots/01-start.png" width="92%" alt="VisualForge 创作首页" />
  <br><sub><b>从一个喜欢的视觉开始</b> —— 上传、粘贴，或在网页图片上使用 VisualForge</sub>
</div>

## VisualForge 是什么

VisualForge 由两部分组成：

- **Chrome 侧边栏插件**：负责捕获参考图、展示分析、选择人物或商品、管理生成结果。
- **本地连接组件（Native Host）**：安全连接你已经登录的 Codex，并调用图像生成能力。无需另填 API Key。

它不是云端素材库，也不会替你公开作品。项目没有账号系统、广告、遥测或中心服务器；作品记录默认保存在本机浏览器中。

## 它能做什么

- **理解参考图**：拆解构图、景别、动作、表情、光线、色彩、材质、氛围与后期质感。
- **换成你的主体**：上传人物或商品照片，参考画面负责“怎么拍”，你的素材负责“拍谁／拍什么”。
- **生成单张或一套作品**：支持单图、2／3／4／6／9／12 个画面和本地宫格合成。
- **逐张检查和修改**：保留每次生成候选、质量建议与最终选择，不用从头再来。
- **保存在本机**：作品、主体素材、生成记录和来源关系由用户自己控制。

<div align="center">
  <img src="assets/screenshots/02-analysis.png" width="92%" alt="VisualForge 参考图理解" />
  <br><sub><b>先理解，再生成</b> —— 分清画面事实、创作方法和需要替换的主体</sub>
</div>

<br>

<div align="center">
  <img src="assets/screenshots/04-result.png" width="92%" alt="VisualForge 真实生成结果" />
  <br><sub><b>结果留在当前作品里</b> —— 查看、选择、修改或导出</sub>
</div>

## 为什么做 VisualForge

看到一张喜欢的照片时，真正困难的不是写一句“同款提示词”，而是说清它为什么成立：人物在画面哪里、镜头离多远、光从哪里来、动作是否符合真实世界、颜色和材质如何共同形成气质。

VisualForge 把这些复杂判断留给系统，把用户流程收成一句话：

> **选一张喜欢的图 → 换成你的主体 → 生成你的版本。**

## 设计理念

- **参考优先**：先守住原图可观察的画面方法，再谈创意变化。
- **职责清楚**：参考图决定视觉；人物／商品素材决定身份与结构，二者不能互相污染。
- **用户做最终决定**：质量检查是建议，不替用户删除候选，也不暗中自动重生。
- **把复杂留给系统**：高级参数默认收起；每一步只有一个清楚的主动作。
- **本地优先、可追溯**：没有 VisualForge 云端账号；生成来源、版本与最终选择都能回看。

## 三步开始

完整图文见[《最小安装指南》](INSTALL.md)。

1. 从 [Releases](https://github.com/dososo/visualforge/releases/latest) 下载适合系统的一个安装包，并运行其中的安装入口。
2. 解压包内 `VisualForge-extension.zip`，在 `chrome://extensions` 开启开发者模式，选择“加载已解压的扩展程序”。
3. 打开 VisualForge，在设置中点击“重新检查连接”；看到“Codex 已连接”即可创作。

> 使用前需要安装并登录 Codex。macOS 包是 Apple Silicon＋Intel 通用版；Windows／Linux 当前提供 x64 包。

## 它如何工作

```text
网页／上传参考图
        ↓
Chrome Side Panel：捕获、编辑、作品管理
        ↓ Native Messaging
VisualForge 本地连接组件
        ↓ 本机 Codex App Server
视觉理解与 imagegen 图像生成
```

VisualForge 不复制 Codex 凭据，不要求 API Key，也不建立自己的图片生成服务器。只有用户主动分析或生成时，所选图片和创作要求才会交给当前登录的 Codex／OpenAI 服务处理。

## 从源码构建

需要 Node.js 22+、pnpm 10+、Chrome 116+，以及已经安装并登录的 Codex。

```bash
git clone https://github.com/dososo/visualforge.git
cd visualforge
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
```

构建后的扩展位于 `apps/extension/.output/chrome-mv3/`。开发环境安装本地连接组件：

```bash
pnpm setup:host
```

仓库采用 pnpm workspace：WXT＋React＋TypeScript 扩展在 `apps/extension/`，Node Native Messaging Host 在 `apps/native-host/`，共享契约和创作逻辑在 `packages/`。

## 隐私与边界

- VisualForge 没有中心服务器、账号、广告和遥测。
- Chrome Web Store 尚未发布；0.5.8 通过 Releases 提供透明的旁加载安装包。
- 只有主动分析／生成时，选中图片和要求才会发送给当前登录的 Codex／OpenAI 服务。
- 请只使用你有权处理的参考图和主体素材；不要用来冒充他人或生成未经同意的敏感内容。
- macOS 0.5.8 Universal 包经 Developer ID 签名、Apple 公证并 Staple；Windows／Linux 包在对应真机签名与连续验收完成前会在 Release 明确标注边界。

详见[隐私说明](PRIVACY.md)、[安全说明](SECURITY.md)和[贡献指南](CONTRIBUTING.md)。

## 许可

[Apache License 2.0](LICENSE) © 2026 爆裂队长 NEXT（BLCaptain）

## 联系作者

**爆裂队长 NEXT(BLCaptain)**

- GitHub:[dososo](https://github.com/dososo)
- X:[@thinkszyg](https://x.com/thinkszyg)
- 邮箱:blteam2026@outlook.com

<div align="center"><sub>© 2026 爆裂队长 NEXT · VisualForge —— 把喜欢的视觉，变成你的作品。</sub></div>
