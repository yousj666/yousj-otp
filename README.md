# Yousj OTP 验证器

自用的 OTP 二次验证工具，两端：浏览器插件 + 安卓 App。数据只存本地，不联网。

## 功能

- TOTP 动态码（6 位），每 N 秒刷新，剩 5 秒变红提醒
- **时长可自定义**：添加时可填周期，默认 15 秒（范围 10~3600 秒）
- 上传二维码图片自动解析 `otpauth://`，只回填表单不直接保存
- 点卡片一键复制验证码
- 每条账号可编辑（✎）/ 删除（×）

## 浏览器插件

`extension/` 目录：Chrome / Edge 适用。

1. 打包 `extension/` 为 zip（或直接用源码目录）
2. 打开 `chrome://extensions`，开启开发者模式
3. 「加载已解压的扩展程序」，选择 `extension/` 目录

## 安卓 App

包名 `cc.yousj.otp`，Kotlin 编写，零第三方运行时依赖（构建时需要 ZXing core 做二维码解析）。

```bash
cd android
./build-apk.sh
```

手工工具链构建（aapt2 + kotlinc + d8 + zipalign + apksigner），不需要 Android Studio / Gradle。
构建产物为 debug 签名，仅适合自用；发布请换正式签名。

## TOTP 说明

- 算法遵循 RFC 6238，已用官方测试向量验证
- 特别注意：Kotlin 里 `shl` / `or` 是同优先级中缀函数，位运算混写必须逐段加括号，否则动态截断会算错（别问我怎么知道的）
- TOTP 对时钟敏感，手机时间必须开自动同步

## 许可证

MIT
