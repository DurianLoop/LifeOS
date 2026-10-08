# README 截图来源

这组图片来自 **LifeOS v0.5.2** 的实际 Electron 界面，源码提交为 `1ca8858ea3fcb752b7af065aa0de8f4c11ff514a`。每张图片均为 1600 × 1100 像素，通过 `webContents.capturePage()` 直接保存，未拼接界面、替换文案或修改应用样式。

| 文件 | 实际界面 |
| --- | --- |
| `desk.png` | 落笔：六格书桌、习惯打卡 |
| `journal.png` | 流年：目录与书本阅读页 |
| `memory.png` | 记忆抽签机：从本地日记抽出一页 |
| `bottles.png` | 漂流瓶：三封封存的未来来信 |
| `companion.png` | 灵犀：ViVi、已安装宠物与宠物库 |

截图中的 8 篇日记与 3 封来信全部为虚构演示内容。运行时创建独立的 workspace 和 Electron profile；不读取个人日记、实际用户配置或桌面应用 profile。只复制发布源码中的公开配置和宠物资源，并使用本地 API 写入样例。浏览器外网请求和 Python 外部 socket 连接均被阻断，未连接 AI 模型。此次捕获没有 renderer 错误；完整公开校验记录见 [`provenance.json`](provenance.json)。

## 重新捕获

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
