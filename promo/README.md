# LifeOS 产品官网

正式网址：https://lifeos-diary.netlify.app/ 。手机网页：https://lifeos-diary.netlify.app/app/ 。本目录包含产品介绍、安装包入口和 v0.6.1 随身档案；手机版功能、数据迁移、隐私和离线边界见 [随身档案说明](app/README.md)。

## 构建与部署

根目录运行 `node promo/build.mjs`，只复制公开文件白名单到 `promo/dist/`，按应用资源内容生成 Worker 版本。运行 `node promo/serve.mjs` 预览；`LIFEOS_PROMO_PORT` 指定端口，`LIFEOS_PROMO_DIST=1` 使用构建产物。测试命令见随身档案说明。

站点名 `lifeos-diary`，唯一正确的站点 ID 为 `07817627-cc67-497b-82e7-fb5cf9516223`。不要使用其他项目遗留的 `.netlify/state.json`。目前没有 Git 自动部署；源码维护于 `codex/pocket-completeness`。

```sh
node promo/build.mjs
netlify deploy --no-build --prod --dir=promo/dist --functions=netlify/functions --site=07817627-cc67-497b-82e7-fb5cf9516223
```

每次发布必须包含 `--functions=netlify/functions`，以保留 AI 网关。部署后核对实际文件、响应头、函数可达性和 Worker 更新。

## 素材和内容

宣传页展示真实产品界面，不读取用户日记、不调用 AI。手机版仅在本机存储资料，AI 选材须由用户确认。ViVi、DSH 与自然声音均保留来源及许可；DSH 动画禁止商业使用。产品标识使用作者提供的书页素材。下载链接固定到经过验证的 GitHub 发行资产；版本变动时同时核对文件和说明，不提供未签名的 iPhone 安装包。
