# 在 iPhone 上免费使用 LifeOS

无需一定从 App Store 下载。你可以在自己的 Windows 电脑上，用免费 Apple 账号给 LifeOS 签名并装到自己的手机。本轮提供 `LifeOS-0.7.1-iphone-unsigned.ipa`：这是为 iPhone 编译的 arm64 应用，签名由你本机的安装工具完成。模拟器 ZIP 不能用于手机安装。

## Windows：Sideloadly

1. 从 [Sideloadly 官网](https://sideloadly.io/) 下载 Windows 版本，按官网提示准备 Apple 驱动和所需的 iTunes、iCloud 组件。使用官方来源的安装程序。
2. 用数据线连接 iPhone，在手机上选择“信任此电脑”，保持设备解锁。
3. 打开 Sideloadly，选择这台 iPhone，把 `LifeOS-0.7.1-iphone-unsigned.ipa` 拖入工具。
4. 在工具中输入你自己的 Apple 账号，并在你自己的设备上完成验证。账号、密码和验证码不需要发给开发者，也不需要写入 LifeOS。
5. 点击 Start，等待签名及安装。按手机提示，在“设置 → 通用 → VPN 与设备管理”信任对应的开发者；若要求开发者模式，按“设置 → 隐私与安全 → 开发者模式”的提示启用。
6. 打开 LifeOS，创建一条测试笔记，退出应用后重开，确认内容仍在。再从“资料库 → 导入与备份”保存一份完整备份。

免费签名的有效期为 **7 天**，免费账号每台设备最多安装 3 个这类应用。Sideloadly 提供自动续签功能，需要电脑可用，设备可连接；无线续签的配对和网络要求以工具当前说明为准。到期后通常需要重新签名才能打开应用。

更新或续签时沿用同一个 Apple 账号和应用标识；**先导出备份，不要为了续签先删除手机上的应用**。卸载会删除本机资料。如果工具提示必须更换应用标识，请先确认已有备份。LifeOS 当前没有自动跨设备同步。

## 其他安装方式

| 方式 | 你是否需要付费 | 主要条件 |
| --- | --- | --- |
| Windows + Sideloadly | 免费 Apple 账号即可 | 定期续签；账号验证由你在工具中完成 |
| Mac + Xcode Personal Team | 免费 Apple 账号即可 | 需要 Mac、Xcode，免费配置同样有 7 天期限 |
| TestFlight | 测试者免费 | 开发者需 Apple Developer Program 会员，完成签名和 App Store Connect 配置；测试构建也有有效期 |
| App Store | 取决于应用定价 | 开发者完成签名、商店提交和 Apple 审核 |

我们目前没有 Apple 开发者签名身份或 App Store Connect 配置，因此本轮不提供已签名的 TestFlight 链接。源码工程已改为自动签名：未来有 Mac 后，可在 Xcode 的 Signing & Capabilities 中选择自己的 Team，再选中连接的 iPhone 运行。

## 兼容性与实际验收

最低部署版本为 iOS 17，iOS 26 及更新版本使用系统 Liquid Glass。CI 会分别编译 iPhone 真机目标和模拟器目标，并在两种 iPhone 模拟器上运行界面验收。iOS 27.2 的实际安装与使用仍需在目标手机上确认，不能把模拟器通过等同于真机安装成功。安装失败时可提供错误文字，账号或验证码无需提供。

官方依据：[Apple 会员与 Personal Team 限制](https://developer.apple.com/support/compare-memberships/)、[Sideloadly 安装与免费签名说明](https://sideloadly.io/)。
