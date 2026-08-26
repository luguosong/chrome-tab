# 09: 接入阿里通义(Qwen/万相)模型档案

**What to build:** 让用户查看阿里通义商业 API 模型(Qwen 旗舰系)与官方开放权重模型、万相 Wan 视频与 Qwen-Image 图像模型,保留别名原地升级与快照归并的历史,正确表示多模态各类型。

**Status:** resolved

决策(grilling 2026-08-26):id `alibaba`、展示名「通义」;万相 Wan 与 Qwen-Image 入档同一厂家;一次全量对齐六家既有口径;主发布源 = 百炼「模型上下架与更新」首表(SSR HTML 纯表格、日粒度、modelID 独立列,对标 DeepSeek HTML 解析先例;qwen.ai 是 SPA 无 feed、GitHub QwenLM 零 releases,均出局)。

- [x] 通义商业旗舰与独立产品差异变体入档(单一主要模型种类),开源尺寸变体(各 B 档 checkpoint)、`latest` 别名、日期快照不另立行、归并家族行动态。
- [x] 万相 Wan(视频生成)与 Qwen-Image(图像生成)随同厂家入档;百炼托管的第三方模型(kimi-k3、ZHIPU/GLM-5.3 等)不误认领。
- [x] 主线别名(qwen-plus/turbo/max 等)与快照的原地升级生成对应「模型动态」,别名自身不立行;退役史暂缓(见下),现役无 retired 行。
- [x] AA 评测 slug 映射人工核验增补(2026-08-26 sitemap 已核:文本模型在 /models/<slug>,媒体模型带 image/、video/、speech-to-text/、text-to-speech/ 路径前缀;reasoning/non-reasoning/effort 分档页与日期快照不映射——同既有排除口径)。
- [x] 通义在图标、「全部」tab 和独立「通义」tab 中可用,详情区分 API 与开放权重渠道。
- [x] 自动检查覆盖表格解析(首表锚定/多 ID 单元格切分/第三方过滤)、归属、基线形状(别名不立行/非退役必有渠道)、陈旧降级与 tab 展示。

## Comments

- **2026-08-26 实现**:新文件 `backend/src/qwenBaseline.ts`(72 行基线 + 百炼表格解析器/匹配器,随厂家基线文件走,同 deepseekBaseline 先例)。资料核验(2026-08-26,研究 `research/alibaba-baseline.md`):百炼「模型上下架与更新」首表(实抓 1MB/首表 398 行;10 表 = 5 唯一 × 2 拷贝只取首表;表头 th 行天然跳过;多 ID 单元格按空白切分;`help-letter-space` 间距 span 须剥)、各模型文档页现价/上下文/最大输出(slug 规律点号→连字符;例外 `qwenvl-ocr`、`wan2-5-t2v`;**软 404 陷阱:HTTP 200 ≠ 页面存在,批量核验须看 title**)、HuggingFace Qwen org 实仓(权重归属与日期)、AA sitemap(2026-08-26 核验,媒体模型带路径前缀)。建模要点(grilling 五裁定):**无版本别名不立行**(qwen-plus/max/flash/turbo 官方自证「滚动更新升级」,同 deepseek-chat;其九快照链留证于所指代模型);3.5 起带版本线正常立行;**开源代级行**(qwen3-open/3.5-open/3.6-open/3.6-27b+35b 归并/qwen3-vl-open,AA slug 只映射旗舰尺寸;qwen3.8 双尺寸例外分行——2.4T 文本与 27B 视觉语言种类不同);qwq/qvq 是 Qwen 品牌线入档(qwq-plus 2025-03-05、qvq-max 03-26 + qvq-plus 06-03 归并),tongyi-/gte/cosyvoice/fun-asr/gui/aitryon 通义他线品牌不入(负例测试固定);**退役史暂缓**(首表无下架行、下线公告正文 JS 渲染 SSR 不可证,qwen-math 等退役线索不入档,回填留后续票);体量 = P0+P1 全收 + P2 代际精选(72 行,对标智谱 44/OpenAI 91 之间;character/voice-enrollment/wanx 应用类不收)。解析:`parseBailianReleases` 只取首 `<table>`、td 四列、日期归一(不补零防御);`resolveQwenModelId` 精确优先+最长前缀(结构化 ID 匹配同 OpenAI 口径,快照归家族);`matchQwenEvents` 同格多 ID 命中同模型只产一条,事件信源统一主发布源页 URL 与基线事件同键去重。接线:modelTracking.ts 四 hunk(import/ALL_BASELINES/pollAlibaba+pollQuietly/头注释);shared ModelProviderId 扩 'alibaba';前端 PROVIDER_LABELS 加「通义」(tab 自键集派生随动,键集断言六→七)。AA 映射 25 条增补(无版本别名与分档页不映射;qwen3-coder-480b/30b、qwen3-omni-30b 是基线认领的开源对应版随行映射;qwen3-6-27b 按官方目录序作 3.6 代代表),aaEvaluations.test 反例 qwen3-max→minimax-m2(通义已成跟踪厂家)。自动检查 6 组:解析(首表锚定/表头跳过/不补零/多 ID/间距 span/拷贝表不解析/空输入)、归属(精确优先/快照前缀/别名 null/第三方 null/通义他线 null)、事件(多 ID 一条/第三方零事件/信源统一)、基线形状(provider 恒一/officialId 唯一/别名四件套不立行/非退役必有渠道/种类不越枚举)、轮询(同键去重/两轮幂等/新日期入库)、陈旧降级(零行标陈旧/档案保留/厂家隔离)。验证:backend 433 + frontend 293 全绿、tsc 三端零错。**提交方式**:新闻会话在场(backend news/、icons/registry/DashboardPage 等大批在途),CONTEXT.md 与 shared/src/index.ts 为双会话混合文件——走备份-回退-重放-提交-恢复分离法,各自 hunks 干净入提交(d151833),新闻会话未提交改动原样保留工作区。缺口记档:文档页 URL 抽验只核了 HTTP 200(title 未逐个校验,软 404 风险低但非零);qwen2.5-72b-instruct 等 AA 页无基线行未映射;qwen3.6 两尺寸页面无明示主打,AA 代表按目录序取 27b。
