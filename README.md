# Yousj OTP 验证器

自用的 OTP 二次验证 + 加密日记工具。**数据只存本地，全程加密，不联网、不上传。**

v2 起共三端：**桌面版**（Windows / macOS）、**浏览器插件**（Chrome / Edge）、安卓 App（v1 沿用）。桌面版与插件版共用同一套加密备份格式，可互相导入导出。

> 截图：`docs/screenshots/`（待补：桌面版验证码页 / 日记页、插件 popup 截图各一张，装好后截真实界面替换）

## 功能

- **验证码**：TOTP / HOTP，SHA1 / SHA256 / SHA512，6 / 8 位，周期可调（默认 30 秒）
  - 大字等宽码 + 30 秒倒计时环，最后 5 秒变黄提醒
  - 添加时可粘贴 `otpauth://` 链接自动解析填表
  - 桌面版点卡片复制；插件版点一下复制并**自动填入当前网页的验证码输入框**（识别 `autocomplete="one-time-code"`、关键词输入框、分散的单字框）
- **日记**：按日期写日记（标题 + 正文 + 心情标签），可搜索、编辑、删除，只存在本地加密库里
- **加密备份**：导出 / 导入加密 JSON 文件（桌面版 ⇄ 插件版互通），导出需输主密码确认
- **主密码与自动锁定**：首次设置主密码，可改密码，可设 1 / 5 / 15 / 30 分钟无操作自动锁定

## 安全模型

- 整个库（账号 + 日记）是一个 JSON，先经 **PBKDF2-HMAC-SHA256（210000 次）** 由主密码派生 32 字节密钥，再用 **AES-256-GCM** 加密落盘
- 解锁前不显示任何内容；桌面版密钥与明文只在主进程持有，渲染层经 IPC 拿验证码，拿不到密钥
- 验证码算法遵循 RFC 4226 / RFC 6238，`core/` 内置官方测试向量自测（见下）
- 源码与备份文件里没有、也不会有任何真实密钥；密钥只存在于你本机加密库中

## 桌面版（Windows / macOS）

到 [Releases](https://github.com/yousj666/yousj-otp/releases) 下载：

- **Windows**：`Yousj OTP Setup 2.0.0.exe`（安装版）或 `Yousj OTP 2.0.0.exe`（portable 免安装版）。未做代码签名，首次运行 SmartScreen 可能提示，点「更多信息 → 仍要运行」。
- **macOS**：`Yousj OTP-2.0.0.dmg`（或 zip），区分 Intel（x64）与 Apple Silicon（arm64）。未签名，首次打开请**右键点应用 →「打开」**；若仍被拦，到「系统设置 → 隐私与安全性」里允许，或执行 `xattr -dr com.apple.quarantine /Applications/Yousj\ OTP.app`。

数据文件位置（Electron userData）：Windows `%APPDATA%/yousj-otp-desktop/`、macOS `~/Library/Application Support/yousj-otp-desktop/`，库文件名为 `vault.json`。

## 浏览器插件

到 [Releases](https://github.com/yousj666/yousj-otp/releases) 下载 `yousj-otp-extension-v2.0.0.zip`，解压后：

1. 打开 `chrome://extensions`（Edge 为 `edge://extensions`），开启开发者模式
2. 「加载已解压的扩展程序」，选择解压出的目录
3. 点工具栏图标，首次设置主密码

popup 分「验证码 / 日记」两个标签页：验证码点一下即复制 + 自动填入网页；日记可快速记一条并看最近几条。账号增删、备份导入导出、改密码在「管理」（options）页。

> 从源码加载时注意：`extension/otp-core.js` 是构建时由 `node scripts/sync-core.mjs` 从 `core/` 同步的副本，克隆仓库后先跑一次该脚本再加载目录（Release 的 zip 已包含）。

## 安卓 App

v1 沿用，见 `android/`：包名 `cc.yousj.otp`，Kotlin 手工工具链构建（aapt2 + kotlinc + d8），`cd android && ./build-apk.sh`。产物为 debug 签名，仅适合自用。

## 开发

```bash
node core/test-rfc.js           # RFC 6238/4226/4648 官方测试向量（硬验收，必须全过）
node core/test-vault-compat.js  # 桌面版 ⇄ 插件版加密备份互解测试
node scripts/sync-core.mjs      # 把 core/otp-core.js 同步到 desktop/ 与 extension/

cd desktop && npm install && npm start   # 本地运行桌面版
```

结构：

- `core/` — 共享核心（UMD，Node 与浏览器通用）：Base32、SHA-1/256/512、HMAC、TOTP/HOTP、otpauth 解析
- `desktop/` — Electron 桌面版（纯 HTML/CSS/JS 无框架，electron-builder 打包）
- `extension/` — MV3 浏览器插件（popup + 管理页 + 自动填入内容脚本）
- `android/` — 安卓 App（v1）
- `.github/workflows/release.yml` — 推 `v*` 标签自动三端打包发 Release

发布：打 `vX.Y.Z` 标签推送即触发 Actions，Windows（NSIS + portable）、macOS（dmg + zip，未签名）、插件 zip 汇入同一个 Release。

## TOTP 说明

- 算法遵循 RFC 6238，已用官方测试向量验证（含 t=20000000000 的 SHA1 = 65353130，以 RFC 原文附录 B 为准）
- TOTP 对时钟敏感，设备时间请开自动同步

## 许可证

MIT
