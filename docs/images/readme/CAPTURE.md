# README 截图来源

本目录的五张原始截图来自 **LifeOS v0.5.2** 的实际 Electron 界面，源码提交为 `1ca8858ea3fcb752b7af065aa0de8f4c11ff514a`。每张原图均为 1600 × 1100 像素，通过 `webContents.capturePage()` 直接保存，未拼接界面、替换文案或修改应用样式。

| 文件 | 实际界面 |
| --- | --- |
| `desk.png` | 落笔：六格书桌、习惯打卡 |
| `journal.png` | 流年：目录与书本阅读页 |
| `memory.png` | 记忆抽签机：从本地日记抽出一页 |
| `bottles.png` | 漂流瓶：三封封存的未来来信 |
| `companion.png` | 灵犀：ViVi、已安装宠物与宠物库 |

截图中的 8 篇日记与 3 封来信全部为虚构演示内容。运行时创建独立的 workspace 和 Electron profile；不读取个人日记、实际用户配置或桌面应用 profile。只复制发布源码中的公开配置和宠物资源，并使用本地 API 写入样例。浏览器外网请求和 Python 外部 socket 连接均被阻断，未连接 AI 模型。此次捕获没有 renderer 错误；完整公开校验记录见 [`provenance.json`](provenance.json)。

## README 展示设计

`editorial/` 保存 README 的排版资产。封面与外部衬纸是展示设计，不属于应用界面；README 中的展示板可点击查看本目录的原始截图。

- `cover-light.svg` / `cover-dark.svg`：纸白与墨绿封面，书页插画和宋体标题；`cover-en-*.svg` 为英文版本。文字转为矢量轮廓以保持跨设备排版，未分发字体文件。
- `desk.png`：完整书桌截图，等比缩放，添加衬纸、细框与阴影。
- `memory.png`：完整阅读页与抽签结果卡片局部叠排，裁切来源明确标注为 `MEMORY DRAW / DETAIL`。
- `letters.png`：裁去原始漂流瓶页下方空白，增加外部邮笺折线装饰。
- `vivi.gif`：v0.5.2 中 `app/assets/pets/vivi/sit.gif` 的原文件，未修改帧率或动画。来源及许可见 [VIVI-LICENSE.md](editorial/VIVI-LICENSE.md)。

三张展示板均为 1800 × 1200 像素；精确裁切与摆放位置见 [screen-sources.json](editorial/screen-sources.json)。原始截图的校验值仍由 `provenance.json` 记录。

设计资产可用 `scripts/design_readme_cover.py`（fontTools）和 `scripts/design_readme_screens.py`（Pillow）重新生成。脚本默认使用本机宋体与 Baskerville 字体，可通过参数指定本机已有字体；字体文件不随仓库分发。

## 重新捕获原始界面

准备一个干净的 v0.5.2 源码目录、Electron，以及安装了项目依赖的 Python。可复用开发环境中的 Electron / Python；脚本始终把数据写入新建的临时目录。

在 PowerShell 中运行，按本机环境替换路径：

```powershell
& 'C:\path\to\electron.exe' '.\scripts\capture_readme.cjs' `
  --source-root 'C:\path\to\clean-v0.5.2-checkout' `
  --python 'C:\path\to\python.exe' `
  --output '.\docs\images\readme' `
  --temp-root 'C:\path\to\capture-temp'
```

`--source-root` 必填。`--output` 默认指向此文档所在目录；`--temp-root` 默认指向系统临时目录下的 `lifeos-readme-capture`；`--python` 默认使用源码目录中的 `desktop/python-runtime/python.exe`。

脚本只启动隐藏窗口。每次运行的日志、隔离数据和 `capture-report.json` 留在临时目录中供检查；不要提交这些临时文件。`latest-run.txt` 记录最近一次成功运行的目录。抽签结果、宠物动画帧和来信的约定时间会随运行变化，因此重拍后的图片哈希不要求相同。

演示中出现的宠物素材保留各自作者与许可，详见应用内署名和发布版本的第三方声明。
