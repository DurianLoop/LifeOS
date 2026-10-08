# LifeOS 产品官网

正式网址：**https://lifeos-diary.netlify.app/**

本目录包含 LifeOS v0.5.2 的产品宣传网站，以及可直接使用的 [随身日记 PWA](https://lifeos-diary.netlify.app/app/)（手机版 v0.1）。宣传页提供真实产品界面、功能介绍、GitHub 源码入口与 Windows / macOS 下载链接；手机版支持本机文字日记、离线翻阅、JSON 备份与可选 AI 问答。前端使用原生 HTML、CSS 和 JavaScript，无第三方运行时、在线字体或构建依赖；AI 请求由 Netlify 函数转发。

手机版的 iPhone 安装方法、数据与隐私边界、桌面日记交换方式见 [随身日记说明](app/README.md)。

## 本地预览

在仓库根目录运行 `node promo/serve.mjs`，打开 http://127.0.0.1:4173/ 。手机版入口为 http://127.0.0.1:4173/app/ ，本地服务器也提供相同的 AI 网关路由。

`LIFEOS_PROMO_PORT` 可调整预览端口，`LIFEOS_PROMO_DIST=1` 可改为预览构建产物。验证离线使用和缓存升级时，请先构建并使用产物预览。

## 构建与部署

运行 `node promo/build.mjs`，生成 `promo/dist/`。构建脚本只复制明确列出的 40 个公开静态文件，不包含开发说明、预览服务器或其他应用目录，并按手机版资源内容生成 Service Worker 缓存版本。

手机版自动检查命令：`node --test --experimental-test-isolation=none tests/mobile-*.test.mjs`。

仓库根目录的 `netlify.toml` 已指定构建命令和发布目录。Netlify 站点名为 `lifeos-diary`，站点 ID 为 `07817627-cc67-497b-82e7-fb5cf9516223`。

登录 Netlify CLI 后，可在仓库根目录手动更新正式站点：

```sh
node promo/build.mjs
netlify deploy --no-build --prod --dir=promo/dist --functions=netlify/functions --site=07817627-cc67-497b-82e7-fb5cf9516223
```

目前未连接 Git 自动部署。配置和源文件保存在 `codex/lifeos-website` 分支。更新必须包含 `--functions=netlify/functions`，不可再使用仅上传静态文件的旧部署脚本，否则 AI 网关可能不在部署中。

## 内容与素材

作者选定的书桌原图保存在 `assets/screens/workspace.png`。记忆抽签机与漂流瓶截图来自空白工作区；灵犀使用 v0.5.2 的真实界面。ViVi 动画与森林鸟鸣录音复用产品素材，来源与权利说明见 [素材致谢](assets/credits.html)。

产品标识使用作者提供的柔和书页素材：导航、页脚和浏览器标签使用静态 PNG，下载区使用翻页 GIF。GIF 仅在图标可见且页面处于前台时播放；暂停动效、系统减少动态效果或页面隐藏时切换为静态 PNG，无 JavaScript 时也显示静态图。

宣传页不读取用户日记、不调用 AI，也不生成模拟产品数据。手机版 `/app/` 单独管理本机日记，仅在用户预览摘录并确认后调用可选 AI 服务。下载与发行说明链接固定到桌面版 v0.5.2；版本更新时应同步核对内容和资源地址。

## 页面交互

- 固定导航使用原生锚点；章节边缘与导航下缘对齐，工作区截图单独保留 12px 留白。
- 手机菜单选择链接后关闭，Escape 返回菜单按钮；前进、后退保持原生历史行为。
- 真实界面可放大查看；ViVi 动作、森林环境音由用户操作。
- 动效支持暂停和系统减少动态效果偏好。
