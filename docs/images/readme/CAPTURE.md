# README 图像来源

## 作者指定的主图

`workspace.png` 由项目作者于 2026-10-08 提供并明确选定用于 README，尺寸为 **1960 × 1308**。文件按原始字节保存，未裁切、改字、调色或拼接；保留空白书桌、习惯清单和桌宠。它不是演示脚本生成的截图，不为此图推定发行标签或源码提交。

校验值及来源说明见 [workspace-source.json](workspace-source.json)。

## 演示界面

以下原始截图来自 **LifeOS v0.5.2** 的实际 Electron 界面，源码提交为 `1ca8858ea3fcb752b7af065aa0de8f4c11ff514a`。每张为 1600 × 1100 像素，通过 `webContents.capturePage()` 直接保存，未拼接界面、替换文字或修改应用样式。

| 文件 | 界面 |
| --- | --- |
| `desk.png` | 脚本生成的六格演示书桌；README 主图使用作者提供的 `workspace.png` |
| `journal.png` | 流年：目录与书本阅读页 |
| `memory.png` | 记忆抽签机：从本地日记抽出一页 |
| `bottles.png` | 漂流瓶：三封封存的未来来信 |
| `companion.png` | 灵犀：ViVi、已安装宠物与宠物库 |

演示中的 8 篇日记与 3 封来信全部为虚构内容。运行时创建独立 workspace 和 Electron profile；不读取个人日记、实际用户配置或桌面应用 profile。只复制发行源码中的公开配置和宠物资源，并使用本地 API 写入样例。渲染器外网请求和 Python 外部 socket 连接均被阻断，未连接 AI 模型。

捕获时没有 renderer 错误，尺寸、文件大小与 SHA-256 记录在 [provenance.json](provenance.json)。

## 专题图版

`editorial/opening-*.png` 与 `reading-*.png` 是「私人文献 / Private papers」专题图版：在完整界面截图之外排入刊名、标题、序号和图注。主图使用作者提供的 `workspace.png`，阅读图版使用上表中的 `journal.png`。截图仅做等比例缩放，不裁切、不覆盖、不修改界面文字或内容；点击 README 图版可以查看各自的原始 PNG。

图版分别提供中文、英文、浅色、深色以及手机专用构图。README 的 `picture` 元素根据视口宽度和颜色主题选择版本；替代文字与正文保留可检索的产品说明，下载链接使用原生文本。

`scripts/design_readme_art.py` 使用 Pillow 和本机合法安装的华文宋体、Bodoni、微软雅黑生成图版，可通过 `--fonts` 指定字体目录。字体文件不随仓库分发。输入截图的 SHA-256、缩放后的完整矩形位置与输出尺寸记载于 [plates.json](editorial/plates.json)。

ViVi 的来源与权利声明保留在 [VIVI-LICENSE.md](editorial/VIVI-LICENSE.md)。其他宠物和自然声沿用发行版的署名与许可。

## 重新捕获演示界面

准备干净的 v0.5.2 源码目录、Electron，以及安装了项目依赖的 Python。脚本始终把数据写入新建的临时目录，不覆盖作者提供的 `workspace.png`。

在 PowerShell 中运行，按本机环境替换路径：

```powershell
& 'C:\path\to\electron.exe' '.\scripts\capture_readme.cjs' `
  --source-root 'C:\path\to\clean-v0.5.2-checkout' `
  --python 'C:\path\to\python.exe' `
  --output '.\docs\images\readme' `
  --temp-root 'C:\path\to\capture-temp'
```

`--source-root` 必填。`--output` 默认指向此目录；`--temp-root` 默认指向系统临时目录下的 `lifeos-readme-capture`；`--python` 默认使用源码目录中的 `desktop/python-runtime/python.exe`。

脚本仅启动隐藏窗口。日志、隔离数据和 `capture-report.json` 留在临时目录中供检查；不要提交这些临时文件。`latest-run.txt` 记录最近一次成功运行的目录。抽签结果、宠物动画帧和来信的约定时间会随运行变化，重拍后的哈希无需相同。
