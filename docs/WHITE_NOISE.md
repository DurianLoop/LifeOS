# 本地自然环境录音

白噪音面板现在使用六段真实环境录音：雨声、炉火、海浪、森林鸟鸣、溪流与夏夜虫鸣。首次播放时只读取本机应用内的 Ogg 文件；没有第三方播放器、广告、远程音频请求或自动播放。打开作者与许可链接属于用户主动查阅来源。

## 来源与许可

音频来自 GitHub 项目 [rafaelmardojai/blanket](https://github.com/rafaelmardojai/blanket)，固定版本 `9d229d2be7cb6619135d55ff9e49926e40298686`。已核实其独立 `SOUNDS_LICENSING.md` 及每段原始作者页面上的音频许可，核实日期为 2026-10-03。这里依据的是录音本身的许可，而非上游应用的代码许可。

| 场景 | 原作者 | 上游剪辑 | 音频许可 |
| --- | --- | --- | --- |
| 雨声 | alex36917 | Porrumentzio | CC BY 4.0 |
| 炉火 | ezwa | — | Public Domain |
| 海浪 | Luftrum | Porrumentzio | CC BY 4.0 |
| 森林鸟鸣 | kvgarlic | Porrumentzio | CC0 1.0 |
| 溪流 | gluckose | — | CC0 1.0 |
| 夏夜虫鸣 | Lisa Redfern | — | Public Domain |

完整原始链接、音频下载地址、作者、许可 URL、固定上游版本、源文件及成品 SHA-256 均见 `app/assets/audio/SOURCES.json`。面板里的“录音来源与许可”打开随应用打包的 `app/assets/audio/ATTRIBUTION.html`，保留可见署名和修改说明。原作者没有为本应用背书。

## 素材处理与体积

- 六段成品长度为 23.538–60 秒，合计 **4,180,114 bytes（约 3.99 MiB）**；每段小于 1.1 MB。
- 从原始音轨截取连续片段，以 2 秒等功率交叉拼接形成圆环，循环接点没有人为静音。
- 统一到约 −25 LUFS；实测范围 −24.98～−25.25 LUFS。对炉火等孤立瞬态作轻度峰值限制，避免为了控制单次爆裂而压低整段音量。
- 以 32 kHz、双声道、Ogg Vorbis quality 4 编码。已用 FFmpeg 重新解码全部六段，记录时长、真峰值、响度、连续能量与循环边界指标。
- 原始下载与转码工具仅保存在忽略目录 `artifacts/audio-work/`，不进入仓库或安装包。安装包现有 `app/**` 规则会包含成品与许可文件，无需附带 FFmpeg 或 Python 音频依赖。

可用 `scripts/prepare_white_noise.py --ffmpeg <ffmpeg路径> --source-dir <六段上游音频目录>` 重建。NumPy 和带 libvorbis 的 FFmpeg 仅用于维护时处理素材，不是运行时依赖。

## 播放行为与资源

- `fetch` 只访问同源 `/assets/audio/*.ogg`，随后用 `decodeAudioData` 解码；不依赖 HTTP Range。
- 场景切换采用 450 ms 淡入淡出；暂停采用 160 ms 淡出，然后停止节点并挂起 AudioContext。
- 保留两段解码缓冲。32 kHz 双声道、每段最多 60 秒时，稳定缓存上限约 29.3 MiB；解码及短暂淡出还会使用临时内存。
- 解码任务串行，快速切换会中止旧下载；无法取消的旧解码完成后会被丢弃，不会误播放或进入缓存。点击“取消”可中止首次加载。
- 切换失败保留当前声音并显示重试提示；首次加载失败回到暂停状态。离开页面会取消请求、关闭音频上下文并释放缓冲。
- 保存场景和音量，但刷新后保持暂停。已移除的城市、乡村、雷雨、列车偏好自动回退为雨声。

`node scripts/test_white_noise.mjs` 覆盖播放与暂停、六场景切换、缓存淘汰、过期请求、串行解码、错误恢复、生命周期清理，以及成品的许可清单、哈希和体积限制。实际 Web Audio 解码与桌面播放由浏览器验收进一步验证。
