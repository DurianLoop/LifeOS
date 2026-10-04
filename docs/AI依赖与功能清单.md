# LifeOS v0.4：AI 依赖与功能清单

> 后续实现更新（2026-10-03）：已新增极简 AI 设置页、五项功能许可、连接测试，以及本机 CC Switch / Codex 接入，并统一模型调用权限。白噪音已改为六段附带来源与许可的自然录音；诗文与文言化偏好支持保存。Past Me 与本地功能依赖标记、问答发送前摘要也已调整。使用方法见 [AI 设置与 Codex 接入](AI设置与Codex接入.md)。下文保留最初审计结果，不作为修复后的状态说明；周复盘时间边界、搜索误匹配等其余问题尚未在本轮修复。

审计日期：2026-10-03。依据当前 `E:\LifeOS` 工作区源码，核对了前端 142 个功能入口、后端模型调用、分析引擎及纪念页服务。本文区分**当前实现**与**建议设计**；配置入口、功能名称或数据库表不代表能力已经接通。本次为静态源码审计，未调用真实模型，也未验证线上部署及用户账号的配置。

## 1. 结论

LifeOS 的记录、索引、检索、统计和大部分观察功能都不需要 DeepSeek。模型主要用于**基于证据回答问题、聊天、文字改写，以及个性化荐诗与缘由**。

这些任务需要的是相应的模型能力，并非只能使用 DeepSeek。桌面已有 DeepSeek、OpenAI、Anthropic、兼容接口等适配；本地模型选项存在，但配置和权限逻辑还需要补齐。公开纪念页的 AI 分身是另一条服务链路，当前没有复用桌面的 DeepSeek 设置。

建议将产品分成“本地基础功能”“按需 AI 增强”“独立的公开站点服务”三个部分。关闭 AI 后，应能继续写、存、找、读、统计和发布普通纪念页。

## 2. 按模块整理

| 模块 | 当前不需要 AI 的能力 | 当前调用模型的部分 | 建议设计 |
| --- | --- | --- | --- |
| 写日记、阅读、模板、习惯打卡、附件 | 全部基础操作在本地完成 | 保存本身不调用；主动开启自动荐诗后，保存可能触发荐诗 | 基础操作持续保持本地；润色、总结作为显式操作 |
| 导入、导出、版本、恢复、备份、加密 | 本地文件和数据库逻辑 | 当前无模型调用 | 无须为了这些能力引入 API |
| 首页、Timeline、On This Day | 时间和原文索引 | 当前无模型调用 | 本地展示即可 |
| Universal Search / 寻迹 | 词语匹配、筛选、排序 | 当前无模型调用，也没有接入向量检索 | 优先修好词法检索；语义检索以后按需增加 |
| Deep Read / 潜入记忆海 | 跨时间的主题证据包、原文阅读 | 当前 Deep Read 本身无模型调用；转入 Ask 才可能调用 | 保留本地阅读；可选增加带引用的主题解释 |
| Ask My Life | 检索、证据筛选、引用 ID 核查 | 证据足够且请求回答时，发送问题和所选摘录，生成解释 | 本地证据始终可用；模型负责回答，不负责制造事实 |
| Past Me / 以前的我 | 截止日期检索逻辑 | 当前按钮直接走 Ask 回答流程，可能调用模型 | 应先审核历史证据，再明确选择“让过去的我回答”；先修时间边界 |
| Roundtable / 圆桌 | 多个截止日期的证据包 | **当前无模型调用，即使配置了 API 也只是证据包** | 若需要多个时期的自己对话，再增加模型层 |
| Future Me / 未来的我 | 通过规则筛出本人写过的目标、愿望、计划 | **当前无模型调用，没有未来人格对话** | 计划回顾可本地完成；情境讨论可选模型，不能当预测 |
| People、Life Map、Memory Graph | 配置、提及提取、共现与统计 | 当前无模型调用 | 可选增加人物别名归并等建议，保留人工确认 |
| Ideas、Beliefs、Projects、Questions、Decisions、Achievements | 栏目、关键词和规则提取候选 | 当前无模型调用 | 需要更好的语义分类时再增加可选 AI，候选与原文分开 |
| Contradictions / 前后观点 | 将同主题较早和较晚的观点并排 | **当前无模型判断矛盾** | 并排阅读保持本地；“是否矛盾及为何”可选 AI 分析 |
| 技能、习惯、Analytics、Self Model、Compare Me | 提及天数、时间变化、显式观点和结构统计 | 当前无模型调用 | AI 可辅助解释，不能把提及次数当真实能力或人格结论 |
| Book、Chapters、Year in Review | 章节候选、年度统计、代表性原文和人工旁注 | 当前无模型叙事生成 | AI 章节标题、年度叙事作为可选增强 |
| Life Movie / 人生放映室 | 月度统计构成的故事板 | 当前无模型调用，也不是完整视频生成器 | 如需旁白可用文本模型；配音、视频是另外的能力与服务 |
| 高级观察：Curiosity / Observatory / Timefold / Mirror / Compass / Topology / Footprint / Lineage | 文本相似、时间间隔、共现图、候选链、统计和规则卡片 | 当前无模型调用 | 先本地发现线索，需要解释时再接 Ask |
| 今日一诗 | 本地诗词原作、作者、注解、候选筛选、去重，以及已生成结果与历史阅读 | **新增个性化推荐需要模型**：从候选选诗并生成“为何是它” | 当前设计合理；可另加纯本地每日诗作为无 API 的选项，现阶段尚未实现 |
| 文言化 | 默认本地词语替换“草译” | 显式选择模型才做完整改写 | 本地草译与 AI 改写分开标注质量；原文始终保留 |
| 白噪音 | Web Audio 本地合成 10 种声音、音量、切换 | 无模型调用 | 不需要 DeepSeek 或在线音频生成 |
| 桌宠 | 显示、动画、拖动、管理 | **聊天需要模型**；当前没有离线聊天降级 | 桌宠基础能力不依赖 API；聊天单独启用 |
| 纪念页、二维码 | 编辑、选篇、预览、发布、更新、撤下、阅读、搜索和 SVG 制码 | 这些操作无模型调用 | 发布需要托管和存储；不要将网络服务依赖混同为 AI 依赖 |
| 纪念页 AI 分身 | 本地规则检索已公开快照；无相关证据可直接返回固定提示 | 访客提问的自然语言回答需要服务端模型 | 独立配置并检查可用性；明确只依据公开记录 |
| Correct AI、Memory Provenance | 人工复核、来源、哈希、修正元数据 | 操作本身无模型调用 | 人工治理与溯源继续本地完成 |
| 同步、公开分享、通知、桌面更新 | 协议、账号、存储、通知和更新逻辑 | 操作本身不需要模型；Cloud AI 是单独服务 | 分别展示连接状态、同步状态与模型状态 |

注意：诗词库界面目前主要回看已经推荐的作品，并不是无需生成就能浏览全部内置诗词的独立书库。二维码算法在本机执行，但当前接口会先联网核实纪念页已发布，因此现有制码流程不是完全离线。

## 3. API 和服务的实际关系

| 路径 | 配置来自哪里 | 当前调用者 | 是否复用桌面 DeepSeek Key |
| --- | --- | --- | --- |
| 桌面 BYOK | 本机 Provider、Model、Base URL 与对应凭据 | Ask / Past Me、AI 文言化、荐诗、桌宠聊天 | 选择 DeepSeek 时是；也可用其他已适配 Provider |
| 本地兼容模型 | 现有 Provider/Base URL 配置 | 理论上可供桌面生成使用 | 不应需要云 Key；目前无 Key 会被配置判断挡住，且切换 mode 不自动切换地址 |
| LifeOS Cloud AI | 同步服务地址、登录 token、服务端 `LIFEOS_CLOUD_AI_*` | 统一路由中的 Ask / 文言化，以及直接云接口 | 否；参考服务默认是 mock，真实模型需要部署者另行配置和账号权限 |
| Netlify 纪念页分身 | 服务端 `OPENAI_API_KEY`、`OPENAI_BASE_URL`；当前模型写死 `gpt-5-mini` | 公开纪念页访客提问 | **否**；通常使用 Netlify AI Gateway 提供的服务端配置 |
| 开发云纪念页分身 | `cloud/memorial.py` 中的 `LIFEOS_CLOUD_AI_*` | 开发云公开页面 | 否；与 Netlify 实现是两条链路 |

纪念页的发布密钥 `MEMORIAL_PUBLISH_TOKEN` 仅用于发布鉴权，不是模型 API Key。普通纪念页发布不需要配置模型。

默认 DeepSeek 模型字符串为 `deepseek-v4-flash`。本次没有核验该名称在具体账号上的可用性；后续应允许连接检测，分别报告 Key、Base URL、模型名称和额度错误，而不是只以“Key 非空”判断已接通。

## 4. 真正发给模型的数据

| 功能 | 输入范围 | 复用与触发 |
| --- | --- | --- |
| Ask / Past Me | 问题，以及本次检索证据的 ID、日期、栏目、来源相对路径和摘录 | 普通 Ask 先审核证据再回答；Past Me 目前直接进入回答。相同输入可走本地 AI 缓存 |
| 今日一诗 | 当日日记正文，去除标题/frontmatter 后最多 6,000 字符，以及候选的作者、篇名、名句、背景、标签 | 自动生成默认关闭；主动开启后保存可触发。同日已有推荐直接读本地，不重复生成 |
| 桌宠聊天 | 当前聊天最近最多 12 条消息，每条最多 1,800 字符，加陪伴提示词 | 不读取日记；禁用模型结果缓存 |
| AI 文言化 | 本次载入或粘贴的文本，最多 20,000 字符，加风格与强度指令 | 默认本地草译；用户选择模型才发出 |
| Netlify 公开分身 | 访客问题、最多 5 篇相关的已公开日记的日期/标题/每篇开头 2,500 字符 | 普通搜索不调用模型；无相关记录时固定回答。当前按访客每日 5 次、全站每日 50 次限制 |

引用 ID 存在只说明引用没有指向不存在的条目，不代表回答中的每个判断都已被原文证实。公开分身也仅根据公开快照回答，不能视为真实本人或完整记忆。

## 5. 已确认的遗漏与不一致

| 优先级 | 问题 | 影响 | 建议处理 |
| --- | --- | --- | --- |
| 高 | AI 模式、启用开关、远端许可没有统一执行 | 桌宠/荐诗绕过统一路由；仅选择 `mode=disabled`、其他开关仍为 true 时仍可能请求。Cloud 分支漏检查远端许可，直接云接口甚至漏检查启用/模式 | 用统一服务处理所有模型调用，分别判断本地推理和远端请求权限 |
| 高 | Past Me / Roundtable 的时间边界不严格 | `m.date IS NULL` 被日期过滤放行；周复盘的 date 正好为空，所以未来周复盘可能进入历史证据包 | 给周复盘明确时间范围；未知日期不能直接通过截止边界 |
| 高 | Past Me 按钮叫 Retrieve，却默认进入模型回答 | 可能在用户以为只检索时发出模型请求 | 复用普通 Ask 的“检索 → 审核 → 回答”流程，按钮标清动作 |
| 中 | Local mode 没有独立的完整配置逻辑 | 选择本地模式后仍可能指向原云服务；无鉴权本地服务被 Key 检查挡住；本地请求被标为 remote | 明确本地地址、模型、健康检查和状态，不强制云 Key，不把本地推理当远端发送 |
| 中 | “发送前显示 payload 摘要”开关未落实 | 后端在模型调用后才计算摘要，前端不消费返回的 `remote_payload` | 保留已有 Ask 证据审核，并在调用前展示实际发送范围；使开关生效 |
| 中 | 功能依赖表与实现不同 | Roundtable、Future Me、Contradictions 被标为 AI，但实际是本地；可能出现错误的“旧 AI 解释”提示 | 将刷新策略与 AI 依赖分开建模；按实际生成结果记录 freshness |
| 中 | AI 产物记录不完整 | Past Me 的回答被记为 Ask；文言化无独立 artifact 刷新；没有通用生成入口 | 分别记录功能、输入版本和结果来源；不要把普通 Artifact Ledger 当 AI 生成器 |
| 中 | Correct AI 的反馈只保存为人工记录 | 当前未将修正用于后续模型提示、检索排序或训练 | 标明“已记录”；若承诺回答会改进，应实现可追踪的反馈应用 |
| 中 | 纪念页发布连接成功不代表分身可用 | 桌面 Key 不会配置 Netlify；开启分身但服务端未接通时，访客提问失败 | 单独检查发布服务和 AI 服务；让分身开关显示真实可用状态 |
| 中 | 公开分身检索命中与送出的摘录可能不一致 | 排名检查全文，但模型只看每篇开头 2,500 字符；命中位于后文时证据缺失 | 截取实际命中位置附近的片段，按证据预算拼接 |
| 中 | Universal Search 对没有命中的原始日记也加分 | `daily_raw` 无条件加 1.5 分，`score > 0` 即算命中，可能导致无关结果和虚高匹配数 | 先判断是否命中，再应用来源优先级；这是本地检索缺陷，不需要用 AI 修复 |
| 后续 | Embeddings / 语义检索仅有接口和表结构 | 没有实际业务调用、任务 worker 或向量检索；“相似”“谱系”等当前仍来自规则和文本结构 | 若词法检索不足，再决定用本地 embedding 或独立兼容服务；聊天 API 不等于向量能力 |

另外，当前桌面纪念页网址校验只接受 HTTPS 的 `*.netlify.app`，尚不支持配置自有域名或本机开发服务。Netlify 配额计数不是原子递增，现有限额也不能视为严格的并发成本上限。

## 6. 建议的产品边界与实施顺序

1. **先修准确性与配置一致性。** 统一 AI 权限和路由，修 Past Me 时间边界、检索模式及本地搜索误匹配。增加 Provider/模型连通检测，区分“有配置”和“真正可用”。
2. **让本地功能与 AI 功能有明确状态。** 本地规则、原文证据、AI 生成分别标记；Roundtable/Future Me 当前展示真实能力。Cloud mock 只作为开发状态，不当正式回答。
3. **保持少量明确的 AI 入口。** 保留 Ask、AI 文言化、个性化荐诗和桌宠聊天。默认打开、翻页、搜索、统计与后台整理不应额外请求模型。自动荐诗延续用户主动开启的设计。
4. **再补确实有价值的增强。** 可以考虑年度叙事、主题解释、圆桌对话、未来情境讨论、人物别名归并；每项都应独立启用，基于选定证据，保留本地基础能力。
5. **公开分身独立运营。** 公开阅读和搜索保持无需模型，分身配置、模型状态与额度独立管理。若以后要支持 DeepSeek，应新增服务端 Provider 适配和配置，不能把桌面个人 Key 放到公开前端。

日常短聊天、文言改写和候选荐诗通常可以从低成本文本模型开始；复杂跨年推理再按效果选模型。没有必要让每个统计卡片或每次保存都调用大型推理模型。

## 7. 142 个前端功能入口的覆盖核对

以下按前端 room 分组，合计 142 项（141 项 baseline 加今日一诗）。白噪音、桌宠、纪念页和产品保管工具属于额外入口，已在前表覆盖。“本地”表示当前该功能主体没有模型调用，不保证其名称所暗示的更高层能力已经实现。

| 分组 | 数量 | 当前 AI 关系 | 入口 |
| --- | --- | --- | --- |
| NOW | 4 | Daily Poetry 新个性化推荐需模型；其余本地 | Home、On This Day、Year in Review、Daily Poetry |
| MEMORY | 6 | 本地；Deep Read 可另转入 Ask | Journal、Timeline、Deep Read、Universal Search、Quotes、Memory Provenance |
| ASK | 1 | 检索本地，生成回答需模型 | Ask My Life |
| BOOK | 5 | 文言化可选模型；其余本地 | Book、Chapters、Beliefs、Contradictions、文言化 |
| PEOPLE | 3 | 本地 | People、Life Map、Memory Graph |
| IDEAS | 5 | 本地 | Ideas、Questions、Projects、Decisions、Forks |
| GROWTH | 10 | 本地 | Skill Constellation、Skill Points、Skill Evidence、Skill Evolution、Builds、Achievements、Habits、Analytics、Word Evolution、Self Model |
| TIME | 6 | Past Me 可调用模型；其余当前本地 | Past Me、Roundtable、Future Me、Time Capsule、Life Movie、Compare Me |
| ARCHIVE | 4 | 操作本身不需要 AI；公开分享可能需要网络服务 | Git Life、CHANGELOG、Correct AI、Private / Share |
| CURIOSITY | 8 | 本地 | Cabinet of Curiosities、Memory Echoes、Hidden Chapters、First / Last、Recurring Questions、Life Rhythms、Skill Alchemy、Serendipity |
| OBSERVATORY | 12 | 本地 | Trajectory Observatory、Personal Eras、Return Map、Dormant Threads、Idea Genealogy、Before / After、Voice Drift、Memory Weather、Skill Bridges、Month Portraits、Archive Health、Early Signals |
| TIMEFOLD | 13 | 本地 | Timefold Atlas、Growth Rings、Novelty Atlas、Bridge Days、Attention Portfolio、Promise Ledger、Future Echoes、Identity Ledger、Motif Atlas、Turning Point Index、Thread Reopenings、Skill Momentum、Seasonal Echoes |
| MIRROR | 13 | 本地 | Mirror Atlas、Intention / Outcome、Closure Candidates、Friction Atlas、Personal Protocols、Boundary Ledger、Quiet Priorities、Idea Survival、Milestone Lead-up、Decision Replay、Fork Replay、Identity Mirror、Completion Texture |
| COMPASS | 13 | 本地 | Compass Atlas、Learning Loops、Skill Transfer Trails、Social Gravity、Place Imprints、Focus Bursts、Visibility Arcs、After Friction、Forgotten Doors、Revision Trails、Evidence Gaps、Questions Worth Asking、Orientation Cards |
| TOPOLOGY | 13 | 本地 | Topology Atlas、Life Neighborhoods、Gateway Nodes、Bridge Memories、Context Signatures、Transition Matrix、Co-occurrence Surprise、Rare Pairings、Orphan Islands、Anchor Memories、Neighborhood Drift、Context Switches、Life Routes |
| FOOTPRINT | 13 | 本地；Artifact 在这里是作品痕迹 | Footprint Atlas、Artifact Ledger、Output Trails、Sharing Trails、Handoff Moments、Audience Map、Feedback Echoes、External Validation、Reuse Trails、Learning → Output、Artifact Lead-up、Contribution Threads、Legacy Questions |
| LINEAGE | 13 | 本地 | Lineage Atlas、Thought → Artifact、Project Families、Artifact Ancestry、Version Trees、Idea-to-Output Latency、Feedback Loops、Rework Cycles、Cross-Pollination、First Proofs、Unfinished Lineages、Release Cadence、Evidence Chain Builder |

## 8. 源码依据

- [模型配置与客户端](../backend/ai_providers.py)：24–48 行为配置和状态，56–94 行为聊天与缓存，95–103 行为 embeddings 接口。
- [产品依赖与元数据](../engine/product_core.py)：57–69 行为功能刷新策略，265–283 行为预留 embedding 表，802 行起为 AI 结果记录。
- [后端入口](../backend/server.py)：361–362 行为日期过滤；739 行起为模型路由；745 行起为桌宠聊天；1089 行起为二维码；1161 行起为搜索；1845 行为保存后荐诗；1955 行起为直接云调用；1957 行起为文言化；1986 行起为 Ask；2018 行起为圆桌。
- 同一后端的 2025 行起仅将 Correct AI 的反馈写入 `corrections`；目前没有后续模型消费逻辑。
- [前端功能与交互](../app/index.html)：880–976 行为 142 项清单；1230 行起为观点复核；1251 行起为 Future Me；1257 行起为年度回顾；1261 行起为故事板；1688 行为 Past Me 点击；1706 行起为普通 Ask 证据审核；1757 行起为 AI 设置。
- [周复盘索引](../engine/rebuild_memory_engine.py)：362 行将 weekly 的 date 设为空。
- [荐诗引擎](../engine/poetry_engine.py)：67 行起读取当天版本、85 行截取正文，156 行起生成，220 行起自动排队。
- [诗词界面](../app/poetry.js)、[诗词原作库](../config/poetry_catalog.json)、[白噪音](../app/white-noise.js)。
- [纪念页快照](../engine/memorial.py)、[发布和云调用](../engine/p2_sync.py)：64 行起发布，85 行起网址校验，109 行起 Cloud AI。
- [Netlify 分身](../netlify/functions/memorial.mjs)：41 行起配置检查，60 行起本地检索，70 行起摘录与模型请求；[公开页面](../memorial-site/memorial.html) 负责阅读与字符串搜索。
- [参考云 AI](../cloud/p2_services.py)：204 行起为订阅检查及 mock/真实服务分流；[开发云分身](../cloud/memorial.py) 为另一套服务实现。

代码后续修改可能改变行号，以上链接以文件和函数为主要定位依据。
