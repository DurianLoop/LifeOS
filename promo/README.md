# LifeOS 产品官网

正式网址：**https://lifeos-diary.netlify.app/**

本目录是 LifeOS v0.5.2 的静态宣传网站，包含真实产品界面、功能介绍、GitHub 源码入口与 Windows / macOS 下载链接。使用原生 HTML、CSS 和 JavaScript，无第三方运行时、在线字体或构建依赖。

## 本地预览

在仓库根目录运行 `node promo/serve.mjs`，打开 http://127.0.0.1:4173/ 。

## 构建与部署

运行 `node promo/build.mjs`，生成 `promo/dist/`。构建脚本只复制明确列出的公开静态文件，不包含开发说明、预览服务器或其他应用目录。

仓库根目录的 `netlify.toml` 已指定构建命令和发布目录。Netlify 站点名为 `lifeos-diary`，站点 ID 为 `07817627-cc67-497b-82e7-fb5cf9516223`。

登录 Netlify CLI 后，可在仓库根目录手动更新正式站点：

```sh
node promo/build.mjs
netlify deploy --no-build --prod --dir=promo/dist --site=07817627-cc67-497b-82e7-fb5cf9516223
```

首次上线使用独立静态部署，目前未连接 Git 自动部署。配置和源文件保存在 `codex/lifeos-website` 分支。

## 内容与素材

作者选定的书桌原图保存在 `assets/screens/workspace.png`。记忆抽签机与漂流瓶截图来自空白工作区；灵犀使用 v0.5.2 的真实界面。ViVi 动画与森林鸟鸣录音复用产品素材，来源与权利说明见 [素材致谢](assets/credits.html)。

产品标识使用作者提供的柔和书页素材：导航、页脚和浏览器标签使用静态 PNG，下载区使用翻页 GIF。GIF 仅在图标可见且页面处于前台时播放；暂停动效、系统减少动态效果或页面隐藏时切换为静态 PNG，无 JavaScript 时也显示静态图。

宣传页不读取用户日记、不调用 AI，也不生成模拟产品数据。下载与发行说明链接固定到 v0.5.2；版本更新时应同步核对内容和资源地址。

## 页面交互

- 固定导航使用原生锚点；章节边缘与导航下缘对齐，工作区截图单独保留 12px 留白。
- 手机菜单选择链接后关闭，Escape 返回菜单按钮；前进、后退保持原生历史行为。
- 真实界面可放大查看；ViVi 动作、森林环境音由用户操作。
- 动效支持暂停和系统减少动态效果偏好。
