<p align="center">
  <img src="https://github.com/molvqingtai/WebChat/blob/master/public/logo.png" width="200" alt="WebChat logo" />
</p>

[English](./README.md) | 简体中文

# WebChat

[![持续集成](https://github.com/molvqingtai/WebChat/actions/workflows/ci.yml/badge.svg)](https://github.com/molvqingtai/WebChat/actions) [![GitHub 许可证](https://img.shields.io/github/license/molvqingtai/WebChat)](https://github.com/molvqingtai/WebChat/blob/master/LICENSE) [![Chrome 网上应用店版本](https://img.shields.io/chrome-web-store/v/cpaedhbidlpnbdfegakhiamfpndhjpgf)](https://chromewebstore.google.com/detail/webchat/cpaedhbidlpnbdfegakhiamfpndhjpgf) [![GitHub 发布](https://img.shields.io/github/v/release/molvqingtai/WebChat)](https://github.com/molvqingtai/WebChat/releases) [![询问 DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/molvqingtai/WebChat)

> 在任何网站上与任何人聊天。

WebChat 是一个去中心化的浏览器扩展，让你能与访问同一网站的人匿名聊天。它使用 WebRTC 进行端到端加密的点对点通信，因此没有中心化的聊天服务器，你的数据始终保留在自己的设备上。

将任意网站变成一个共享聊天室，并与已经身处其中的人们建立连接。

## 安装

<p align="center">
  <a href="https://chromewebstore.google.com/detail/webchat/cpaedhbidlpnbdfegakhiamfpndhjpgf"><img src="https://img.shields.io/badge/Chrome-4285F4?style=for-the-badge&amp;logo=googlechrome&amp;logoColor=white" alt="Google Chrome" /></a>
  <a href="https://microsoftedge.microsoft.com/addons/detail/mmfdplbomjjlgdffecapcpgjmhfhmiob"><img src="https://img.shields.io/badge/Edge-0078D7?style=for-the-badge&amp;logo=microsoftedge&amp;logoColor=white" alt="Microsoft Edge" /></a>
  <a href="https://addons.mozilla.org/firefox/addon/webchat/"><img src="https://img.shields.io/badge/Firefox-FF7139?style=for-the-badge&amp;logo=firefoxbrowser&amp;logoColor=white" alt="Mozilla Firefox" /></a>
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/webchat/cpaedhbidlpnbdfegakhiamfpndhjpgf">Chrome 网上应用店</a>
  &nbsp;&middot;&nbsp;
  <a href="https://microsoftedge.microsoft.com/addons/detail/mmfdplbomjjlgdffecapcpgjmhfhmiob">Microsoft Edge 扩展</a>
  &nbsp;&middot;&nbsp;
  <a href="https://addons.mozilla.org/firefox/addon/webchat/">Firefox 扩展</a>
</p>

## 使用方法

安装 WebChat 后，每个网站的右下角都会出现一个幽灵图标。点击它即可加入该网站的聊天室，与其他访客聊天。

## 演示

https://github.com/user-attachments/assets/e7ac9b8e-1b6c-43fb-8469-7a0a2c09d450

## 社区

加入 [WebChat Discord 社区](https://discord.com/channels/1398133810398367805/1398137562043908248)，分享反馈、提出问题，并结识其他用户。

## 构建基础

WebChat 建立在以下优秀的开源项目之上：

- **[Remesh](https://github.com/remesh-js/remesh)** 提供了受 DDD 启发的状态模型，使应用逻辑独立于 React UI。
- **[shadcn/ui](https://ui.shadcn.com/)** 提供了可访问、可定制的 UI 基础组件。
- **[WXT](https://wxt.dev/)** 提供了跨浏览器扩展框架与构建工具。
- **[Comctx](https://github.com/molvqingtai/comctx)** 提供了扩展各 JavaScript 上下文之间的 RPC 通信能力。
- **[Artico](https://github.com/matallui/artico)** 提供默认的 WebRTC 房间传输。
- **[Trystero](https://github.com/dmotz/trystero)** 提供可选的 WebRTC 房间传输，并使用其默认的 Nostr 策略。
- **[ugly-avatar](https://github.com/txstc55/ugly-avatar)** 生成了 WebChat 独具特色的随机头像。

## 许可证

WebChat 基于 [MIT 许可证](./LICENSE) 开放使用。
