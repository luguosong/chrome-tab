import { describe, expect, it } from 'vitest'
import type { ModelKind } from 'chrome-tab-shared'
import { SINGLETON_TYPES, TYPE_SPANS } from './icons'
import { createApp } from './app'
import { bootstrap } from './seed'
import { openDb, type Db } from './db'
import {
  ANTHROPIC_BASELINE,
  ANTHROPIC_RELEASES_URL,
  ModelTrackingService,
  XAI_BASELINE,
  XAI_RELEASES_URL,
  ZHIPU_BASELINE,
  ZHIPU_RELEASES_URL,
  matchAnthropicEvent,
  matchXaiEvent,
  matchZhipuEvent,
  normalizeAnthropicDate,
  normalizeZhipuDate,
  parseAnthropicReleases,
  parseXaiReleaseNotes,
  parseZhipuReleases,
  type ModelTrackingDeps,
} from './modelTracking'
import { DEEPSEEK_BASELINE, DEEPSEEK_UPDATES_URL, matchDeepSeekEvent, parseDeepSeekUpdates } from './deepseekBaseline'

/**
 * 模型追踪自动检查(issues/01:单例/占格、持久化、陈旧降级 + 鉴权;issues/02:八类
 * 映射、厂家归属、历史去重、多事件保留、退役排序、详情缺省值;issues/04:Anthropic
 * 解析/归属、固定快照识别、外部模型排除、退役保留、双厂家隔离)。IO 全经
 * ModelTrackingDeps 注入假实现,零真网(videoUpdates 红线)。
 */

/** 智谱发布页快照节选(2026-08-25 实抓口径:label 不补零、相对/绝对链接混用;含第三方 Vidu 块)。 */
const ZHIPU_MD = `# 新品发布

<Update label="2026-8-19" description="GLM-5.3 新一代旗舰模型上线">
  💬 [**GLM-5.3**](https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3)

  * 更强的编程能力
</Update>

<Update label="2026-06-16" description="GLM-5.2 新一代旗舰模型上线">
  💬 [**GLM-5.2**](/cn/guide/models/text/glm-5.2)

  * 支持 1M 无损上下文
</Update>

<Update label="2026-05-29" description="GLM Coding Plan 团队版上线">
  🤝 [**GLM Coding Plan 团队版**](/cn/coding-plan/team)

  * 面向企业与开发团队
</Update>

<Update label="2026-02-03" description="GLM-9.9 未来旗舰模型上线">
  💬 [**GLM-9.9**](/cn/guide/models/text/glm-9.9)

  * 基线外型号(待人工核验)
</Update>

<Update label="2025-06-18" description="接入两个 Vidu 热门视频生成模型">
  📺 [**Vidu Q1**](/cn/guide/models/video-generation/viduq1)

  * 聚焦高质量视频创作

  📺 [**Vidu 2**](/cn/guide/models/video-generation/vidu2)
</Update>
`

/**
 * Anthropic release notes 快照节选(2026-08-25 实抓口径:`### 日期` 段 + `* ` 条目;
 * 混有 SDK/平台功能、fast mode、Mythos(基线外)与弃用公告——正是双条件归属要过滤的噪音)。
 */
const ANTHROPIC_MD = `# Claude Platform release notes

### August 20, 2026

* We've released **v1.0 of the [Python SDK](https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/python)**. The SDK's HTTP layer moves from httpx to httpx2.

### July 24, 2026

* We've launched **Claude Opus 5** (\`claude-opus-5\`), a step-change improvement over Claude Opus 4.8. See [What's new in Claude Opus 5](https://platform.claude.com/docs/en/models/opus-5/whats-new-opus-5) for new features and migration guidance.

* We've removed [fast mode](https://platform.claude.com/docs/en/build-with-claude/fast-mode#supported-models) for Claude Opus 4.7. To continue using fast mode, migrate to [Claude Opus 5](https://platform.claude.com/docs/en/about-claude/models/migration-guide#migrating-from-claude-opus-47).

### June 9, 2026

* We've launched **Claude Fable 5** (\`claude-fable-5\`), our most capable widely released model, alongside **Claude Mythos 5** (\`claude-mythos-5\`) for Project Glasswing participants. See [Introducing Claude Fable 5 and Claude Mythos 5](https://platform.claude.com/docs/en/models/fable-5/introducing-claude-fable-5-and-claude-mythos-5) for capabilities.

### June 5, 2026

* We announced the deprecation of the Claude Opus 4.1 model (\`claude-opus-4-1-20250805\`), with retirement scheduled for August 5, 2026. Read more in [Model deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations).

### October 3rd, 2024

* [Claude Haiku 3.5](https://www.anthropic.com/claude/haiku) is now available on the Claude API as a text-only model.
`

/**
 * xAI 发布流快照节选(2026-08-25 实抓口径:`## 月份`/`### 条目`,当年标题不带年份、
 * 往年显式;混有 Grok Bot 产品条目、家族合并条目与历史能力公告——标题归属要过滤的噪音)。
 */
const XAI_MD = `# Release Notes

## August

### Grok 4.6

Grok 4.6, SpaceXAI's frontier model for coding, agentic tasks, and knowledge work, is now available on the xAI API. See the [Grok 4.6 overview](/developers/grok-4-6) and the [announcement](https://x.ai/news/grok-4-6).

### Grok Bot

Grok Bot is now available. See the [Grok Bot overview](/grok-bot/overview).

## July

### Grok Voice Think Fast 2.0 is available

\`grok-voice-think-fast-2.0\` is now available with Speech to Speech. \`grok-voice-latest\` will route to this model starting August 5, 2026. To get started, see the [Speech to Speech docs](/developers/model-capabilities/audio/speech-to-speech).

### grok-imagine-video-1.5 modalities

\`grok-imagine-video-1.5\` now supports text-to-video, image-to-video, and reference-to-video. See [Video Generation](/developers/model-capabilities/video/generation).

## March

### Grok 4.20 and Grok 4.20 Multi-agent are live

* For more details on Grok 4.20 Multi-agent, check out the [docs](/developers/model-capabilities/text/multi-agent)

## December 2025

### Grok Speech to Speech API is released

Grok Speech to Speech API is generally available.
`

/**
 * DeepSeek API Change Log 快照节选(2026-08-25 实抓口径:`<h2 id="date-…">Date:` 日期
 * 段 + `<h3 id="…">` 小节)。噪音齐备:页首非日期 h2 段(含其内 h3)、别名标题段
 * (deepseek-chat)、家族段(DeepSeek-V4)、非模型段(New API Features)、实体标题
 * (&amp;)、Vision-Exp 节正文提及 V4-Flash、锚点零宽字符——正是标题词边界归属要过滤的形态。
 */
const DEEPSEEK_HTML = `<html><body>
<h2>On this page</h2><h3>Model Details</h3>
<h2 class="anchor" id="date-2026-08-21">Date: 2026-08-21</h2>
<h3 class="anchor" id="deepseek-v4-flash-vision-exp-release">DeepSeek-V4-Flash-Vision-Exp Release<a href="#x" class="hash-link">​</a></h3>
<p>In terms of pure-text capabilities, DeepSeek-V4-Flash-Vision-Exp is on par with the official DeepSeek-V4-Flash.</p>
<h2 class="anchor" id="date-2026-08-13">Date: 2026-08-13</h2>
<h3 class="anchor" id="deepseek-v4-pro-update">DeepSeek-V4-Pro Update<a href="#x">​</a></h3>
<p>The GA release of DeepSeek-V4-Pro has been rolled out on the APP, Web, and API.</p>
<h2 class="anchor" id="date-2026-04-24">Date: 2026-04-24</h2>
<h3 class="anchor" id="deepseek-v4">DeepSeek-V4</h3>
<p>The DeepSeek API now supports V4-Pro and V4-Flash.</p>
<h2 class="anchor" id="date-2025-12-01">Date: 2025-12-01</h2>
<h3 class="anchor" id="deepseek-v32">DeepSeek-V3.2</h3>
<h3 class="anchor" id="deepseek-v32-speciale">DeepSeek-V3.2-Speciale</h3>
<h2 class="anchor" id="date-2025-03-24">Date: 2025-03-24</h2>
<h3 class="anchor" id="deepseek-chat">deepseek-chat</h3>
<p>The deepseek-chat model has been upgraded to DeepSeek-V3-0324.</p>
<h2 class="anchor" id="date-2024-09-05">Date: 2024-09-05</h2>
<h3 class="anchor" id="deepseek-coder--deepseek-chat-upgraded-to-deepseek-v25-model">deepseek-coder &amp; deepseek-chat Upgraded to DeepSeek V2.5 Model</h3>
<h2 class="anchor" id="date-2024-07-25">Date: 2024-07-25</h2>
<h3 class="anchor" id="new-api-features">New API Features</h3>
</body></html>`

/**
 * 按 URL 分发页面。单字符串 = 智谱页内容 + Anthropic/xAI 页固定夹具(既有单厂家
 * 用例下三轮询都成功且行为确定);Record 原样分发,未列出的 URL 抛错。
 */
function makeDeps(md: string | Record<string, string>): ModelTrackingDeps {
  const pages: Record<string, string> =
    typeof md === 'string'
      ? {
          [ZHIPU_RELEASES_URL]: md,
          [ANTHROPIC_RELEASES_URL]: ANTHROPIC_MD,
          [XAI_RELEASES_URL]: XAI_MD,
          [DEEPSEEK_UPDATES_URL]: DEEPSEEK_HTML,
        }
      : md
  return {
    fetchText: async (url) => {
      const page = pages[url]
      if (page === undefined) throw new Error('HTTP 404')
      return page
    },
  }
}

function failingDeps(): ModelTrackingDeps {
  return { fetchText: async () => { throw new Error('HTTP 503') } }
}

async function makeService(db: Db, deps: ModelTrackingDeps): Promise<ModelTrackingService> {
  const svc = new ModelTrackingService(db, deps)
  await svc.init() // 基线入档 + 首轮取数(init 内 pollQuietly 不被等待,测试显式 await poll)
  return svc
}

/** 档案中按 officialId 取模型(测试便利)。 */
async function byId(svc: ModelTrackingService, officialId: string) {
  const a = await svc.archive()
  return a.models.find((m) => m.officialId === officialId)
}

/** 三厂家基线总行数(init 入档的期望值)。 */
const TOTAL_BASELINE =
  ZHIPU_BASELINE.length + ANTHROPIC_BASELINE.length + XAI_BASELINE.length + DEEPSEEK_BASELINE.length

describe('模型追踪:图标类型接线(单例/占格)', () => {
  it('MODEL 进单例枚举与跨格表(3×2=6 格,对齐前端注册表)', () => {
    expect(SINGLETON_TYPES).toContain('MODEL')
    expect(TYPE_SPANS.MODEL).toBe(6)
  })
})

describe('模型追踪:智谱发布页解析(纯函数)', () => {
  it('日期归一化:不补零 label 补齐、非法日期拒绝', () => {
    expect(normalizeZhipuDate('2026-8-19')).toBe('2026-08-19')
    expect(normalizeZhipuDate('2026-06-16')).toBe('2026-06-16')
    expect(normalizeZhipuDate('2026-13-01')).toBeNull()
    expect(normalizeZhipuDate('')).toBeNull()
  })

  it('提取 Update 块:label/description/块内首个链接;相对路径归一为绝对', () => {
    const updates = parseZhipuReleases(ZHIPU_MD)
    expect(updates).toHaveLength(5)
    expect(updates[0]).toEqual({
      date: '2026-08-19',
      description: 'GLM-5.3 新一代旗舰模型上线',
      docUrl: 'https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3',
    })
    expect(updates[1]!.docUrl).toBe('https://docs.bigmodel.cn/cn/guide/models/text/glm-5.2')
  })

  it('畸形/无日期块跳过,空文返回空数组', () => {
    expect(parseZhipuReleases('')).toEqual([])
    expect(
      parseZhipuReleases('<Update label="bad" description="x"></Update>'),
    ).toEqual([])
  })

  it('label/description 属性次序无关(上游调序不静默清零)', () => {
    const [u] = parseZhipuReleases(
      '<Update description="GLM-5.3 新一代旗舰模型上线" label="2026-8-19">\n[**GLM-5.3**](/cn/guide/models/text/glm-5.3)\n</Update>',
    )
    expect(u).toEqual({
      date: '2026-08-19',
      description: 'GLM-5.3 新一代旗舰模型上线',
      docUrl: 'https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3',
    })
  })

  it('基线双条件匹配:GLM-5.3/GLM-5.2 块产事件;基线外型号(GLM-9.9)与非模型块跳过', () => {
    const updates = parseZhipuReleases(ZHIPU_MD)
    expect(matchZhipuEvent(updates[0]!)).toEqual({
      officialId: 'glm-5.3',
      event: {
        kind: 'updated',
        occurredOn: '2026-08-19',
        title: 'GLM-5.3 新一代旗舰模型上线',
        sourceUrl: 'https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3',
      },
    })
    expect(matchZhipuEvent(updates[1]!)!.officialId).toBe('glm-5.2')
    expect(matchZhipuEvent(updates[2]!)).toBeNull() // GLM Coding Plan(非模型)
    expect(matchZhipuEvent(updates[3]!)).toBeNull() // GLM-9.9(基线外,待核验)
  })

  it('防上游张冠李戴:描述不含基线 alias 时,即便链接 slug 相同也不归属', () => {
    // 实测坑:GLM-Image 块误链 glm-4.7 文档页——描述与链接双条件缺一不可
    const [u] = parseZhipuReleases(
      '<Update label="2026-01-14" description="GLM-Image 图像生成模型上线">\n[**GLM-Image**](/cn/guide/models/text/glm-4.7)\n</Update>',
    )
    expect(matchZhipuEvent(u!)).toBeNull()
  })

  it('厂家归属:平台托管的第三方模型(Vidu)不进基线、其发布块不产智谱动态', () => {
    // 研究研究 §5:智谱目录的 Vidu 只是平台接入,不是智谱自研——基线不含、块不匹配
    expect(ZHIPU_BASELINE.some((b) => b.officialId.includes('vidu'))).toBe(false)
    const updates = parseZhipuReleases(ZHIPU_MD)
    expect(matchZhipuEvent(updates[4]!)).toBeNull()
  })

  it('alias/slug 词边界:「GLM-4.7」不认领「GLM-4.7-Flash」的块,「…/glm-4」不认领「…/glm-4-long」', () => {
    const [flash] = parseZhipuReleases(
      '<Update label="2026-01-19" description="GLM-4.7-Flash 免费模型上线">\n[**GLM-4.7-Flash**](/cn/guide/models/free/glm-4.7-flash)\n</Update>',
    )
    expect(matchZhipuEvent(flash!)!.officialId).toBe('glm-4.7-flash') // 归 Flash 自己,非 glm-4.7
    const [long] = parseZhipuReleases(
      '<Update label="2026-01-01" description="GLM-4-Long 长文本模型上线">\n[**GLM-4-Long**](/cn/guide/models/text/glm-4-long)\n</Update>',
    )
    expect(matchZhipuEvent(long!)!.officialId).toBe('glm-4-long') // 非 glm-4-flash(其 slug 为 /text/glm-4 前缀)
  })
})

describe('模型追踪:基线自身(issues/02 八类全量)', () => {
  it('八类映射:基线覆盖全部 ModelKind,且 provider/officialId 唯一', () => {
    const kinds = new Set<ModelKind>(ZHIPU_BASELINE.map((b) => b.kind))
    expect(kinds).toEqual(
      new Set<ModelKind>([
        'text',
        'multimodal_understanding',
        'image_generation',
        'video_generation',
        'audio_speech',
        'embedding',
        'rerank',
        'moderation_classification',
      ]),
    )
    for (const b of ZHIPU_BASELINE) expect(b.provider).toBe('zhipu')
    expect(new Set(ZHIPU_BASELINE.map((b) => b.officialId)).size).toBe(ZHIPU_BASELINE.length)
  })

  it('独立命名变体分立、日期快照归并:FlashX/Flash 各自一行,-250414 不另立', () => {
    const ids = new Set(ZHIPU_BASELINE.map((b) => b.officialId))
    expect(ids.has('glm-4.7-flashx')).toBe(true)
    expect(ids.has('glm-4.7-flash')).toBe(true)
    expect([...ids].some((id) => id.endsWith('-250414'))).toBe(false)
  })

  it('已退役模型入档且 stage=retired、排序沉底(智谱 2 条 + Anthropic 6 条 + xAI 1 条 + DeepSeek 8 条)', async () => {
    const { db } = openDb(':memory:')
    const svc = await makeService(db, makeDeps(ZHIPU_MD))
    const a = await svc.archive()
    const retired = a.models.filter((m) => m.stage === 'retired')
    expect(retired.map((m) => m.officialId).sort()).toEqual([
      'claude-3-5-haiku', 'claude-3-7-sonnet', 'claude-3-haiku', 'claude-opus-4', 'claude-opus-4-1', 'claude-sonnet-4',
      'deepseek-coder-v2', 'deepseek-r1', 'deepseek-v2', 'deepseek-v2.5', 'deepseek-v3', 'deepseek-v3.1', 'deepseek-v3.2', 'deepseek-v3.2-speciale',
      'glm-4-0520', 'glm-z1',
      'grok-code-fast-1',
    ])
    // retired 沉底:其后不再有可用模型
    const firstRetired = a.models.findIndex((m) => m.stage === 'retired')
    expect(a.models.slice(firstRetired).every((m) => m.stage === 'retired')).toBe(true)
  })

  it('多事件保留:GLM-Z1 系列 上线 + 退役 两条动态共存;基线 init 幂等不翻倍', async () => {
    const { db } = openDb(':memory:')
    await makeService(db, makeDeps(''))
    await makeService(db, makeDeps('')) // 二轮 init(重启口径)
    const svc = new ModelTrackingService(db, makeDeps(''))
    const z1 = await byId(svc, 'glm-z1')
    expect(z1!.events).toHaveLength(2)
    expect(z1!.events.map((e) => e.kind).sort()).toEqual(['api_available', 'retired'])
  })
})

describe('模型追踪:档案服务(持久化/历史去重/陈旧)', () => {
  it('init 基线入档:双厂家全量模型、profile 字段(定价/限额/参数量)齐备;首轮取数后源就位', async () => {
    const { db } = openDb(':memory:')
    const svc = await makeService(db, makeDeps(ZHIPU_MD))
    await svc.pollZhipu()
    await svc.pollAnthropic()
    const a = await svc.archive()
    expect(a.models).toHaveLength(TOTAL_BASELINE)
    const glm53 = a.models.find((m) => m.officialId === 'glm-5.3')!
    expect(glm53.kind).toBe('text')
    expect(glm53.stage).toBe('ga')
    expect(glm53.pricing!.entries[0]).toEqual({ text: '输入 8 元/百万 tokens', scope: null })
    expect(glm53.pricing!.region).toContain('中国大陆')
    expect(glm53.limits).toEqual([
      { label: '上下文窗口', text: '1M', scope: null },
      { label: '最大输出', text: '128K', scope: null },
    ])
    const source = (p: string) => a.sources.find((s) => s.provider === p)!
    expect(source('zhipu')).toMatchObject({ stale: false, lastSuccessAt: expect.any(String) })
    expect(source('anthropic')).toMatchObject({ stale: false, lastSuccessAt: expect.any(String) })
  })

  it('详情缺省值:官方未披露的参数量/限额/价格在档案侧为 null(前端显示「未知」)', async () => {
    const { db } = openDb(':memory:')
    const svc = await makeService(db, makeDeps(''))
    // glm-4-0520:退役模型,价格/限额/参数量均未披露
    const m = await byId(svc, 'glm-4-0520')
    expect(m!.pricing).toBeNull()
    expect(m!.limits).toBeNull()
    expect(m!.trainingParams).toBeNull()
  })

  it('官方披露的训练参数量结构化保留(MoE 总/激活分记,CONTEXT.md 口径)', async () => {
    const { db } = openDb(':memory:')
    const svc = await makeService(db, makeDeps(''))
    expect((await byId(svc, 'glm-5'))!.trainingParams).toEqual({ total: '744B', active: '40B' })
    expect((await byId(svc, 'glm-4.6v'))!.trainingParams).toEqual({ total: '106B', active: '12B' })
    expect((await byId(svc, 'glm-ocr'))!.trainingParams).toEqual({ total: '0.9B', active: null })
  })

  it('历史去重(块链接路径):基线事件以块内文档链为信源时,同公告块不再产 updated', async () => {
    // 场景:上游把 2025-04-14 合并块改写为 GLM-Z1 单模型块并链接其文档页——
    // 基线 api_available 已占 (glm-z1, 2025-04-14, /text/glm-z1) 键,poll 跳过
    const { db } = openDb(':memory:')
    const md = `<Update label="2025-4-14" description="GLM-Z1 推理模型系列上线">\n[**GLM-Z1**](/cn/guide/models/text/glm-z1)\n</Update>`
    const svc = await makeService(db, makeDeps(md))
    await svc.pollZhipu()
    const z1 = await byId(svc, 'glm-z1')
    expect(z1!.events).toHaveLength(2) // 基线 api_available + retired,无 updated 混入
  })

  it('历史去重:基线已核验的公告,自动解析不再补「updated」重复行', async () => {
    const { db } = openDb(':memory:')
    const svc = await makeService(db, makeDeps(ZHIPU_MD))
    await svc.pollZhipu()
    await svc.pollZhipu() // 两轮:同页幂等 + 基线事件在场
    const glm53 = await byId(svc, 'glm-5.3')
    // 2026-08-19 公告只有基线 api_available 一条(无 'updated' 重复)
    expect(glm53!.events).toHaveLength(1)
    expect(glm53!.events[0]).toMatchObject({ kind: 'api_available', occurredOn: '2026-08-19' })
    const glm52 = await byId(svc, 'glm-5.2')
    expect(glm52!.events).toHaveLength(1)
    expect(glm52!.events[0]!.kind).toBe('api_available')
  })

  it('issues/01 旧库的 updated 同键事件被基线语义化事件取代(升级清理)', async () => {
    const { db } = openDb(':memory:')
    // 模拟 01 时期库:直接落一条自动解析口径的 updated(同键于 02 基线事件)
    const svc = new ModelTrackingService(db, makeDeps(''))
    await svc.init()
    const modelId = (await byId(svc, 'glm-5.3'))!.id
    await db
      .insertInto('model_events')
      .values({
        model_id: modelId,
        kind: 'updated',
        occurred_on: '2026-08-19',
        title: 'GLM-5.3 新一代旗舰模型上线',
        source_url: 'https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3',
        created_at: new Date().toISOString(),
      })
      .execute()
    // 升级重启:新基线 init 清理旧 updated,同公告只剩 api_available
    const upgraded = new ModelTrackingService(db, makeDeps(''))
    await upgraded.init()
    const after = await byId(upgraded, 'glm-5.3')
    expect(after!.events).toHaveLength(1)
    expect(after!.events[0]!.kind).toBe('api_available')
  })

  it('自动解析仍能捕获基线未覆盖的新公告(kind=updated)', async () => {
    const { db } = openDb(':memory:')
    // 构造基线模型的未来新公告:日期不在基线事件里 → 自动入库 updated(与基线上线事件共存)
    const md = `<Update label="2026-9-9" description="GLM-5.3 价格下调">\n[**GLM-5.3**](/cn/guide/models/text/glm-5.3)\n</Update>`
    const svc = await makeService(db, makeDeps(md))
    await svc.pollZhipu()
    const glm53 = await byId(svc, 'glm-5.3')
    expect(glm53!.events.map((e) => e.kind)).toEqual(['updated', 'api_available'])
  })

  it('服务重启(同库新实例)档案仍在——持久化而非内存态', async () => {
    const { db } = openDb(':memory:')
    const svc = await makeService(db, makeDeps(ZHIPU_MD))
    await svc.pollZhipu()
    // 模拟重启:新 Service 挂同一 db,不再 init/poll,直接读
    const revived = new ModelTrackingService(db, makeDeps(''))
    const a = await revived.archive()
    expect(a.models).toHaveLength(TOTAL_BASELINE)
    expect((await byId(revived, 'glm-5.3'))!.events.length).toBeGreaterThan(0)
  })

  it('重复取数去重:同发布页两轮入库,事件不翻倍', async () => {
    const { db } = openDb(':memory:')
    const svc = await makeService(db, makeDeps(ZHIPU_MD))
    await svc.pollZhipu()
    await svc.pollZhipu()
    const a = await svc.archive()
    for (const m of a.models) {
      const keys = new Set(m.events.map((e) => `${e.kind}|${e.occurredOn}|${e.sourceUrl}`))
      expect(keys.size).toBe(m.events.length)
    }
  })

  it('信源失败降级:保留最后成功结果并标记陈旧,恢复后陈旧清除', async () => {
    const { db } = openDb(':memory:')
    const svc = await makeService(db, makeDeps(ZHIPU_MD))
    await svc.pollZhipu()
    const failing = new ModelTrackingService(db, failingDeps())
    await expect(failing.pollZhipu()).rejects.toThrow('HTTP 503')
    let a = await failing.archive()
    const zhipu = () => a.sources.find((s) => s.provider === 'zhipu')!
    expect(zhipu()).toMatchObject({ stale: true })
    expect((await byId(failing, 'glm-5.3'))!.events.length).toBeGreaterThan(0) // 档案保留
    const ok = new ModelTrackingService(db, makeDeps(ZHIPU_MD))
    await ok.pollZhipu()
    a = await ok.archive()
    expect(zhipu()!.stale).toBe(false)
  })

  it('上游改版降级:200 但零结构化块 → 抛错并置陈旧,既有档案保留;另一厂家不受牵连', async () => {
    const { db } = openDb(':memory:')
    const svc = await makeService(db, makeDeps(ZHIPU_MD))
    await svc.pollZhipu()
    // 智谱页改版为无结构化块;Anthropic 页仍是有效夹具(makeDeps 单字符串语义)
    const drifty = new ModelTrackingService(db, makeDeps('<html>上游改版了</html>'))
    await expect(drifty.pollZhipu()).rejects.toThrow('疑似上游改版')
    await drifty.pollAnthropic()
    const a = await drifty.archive()
    const source = (p: string) => a.sources.find((s) => s.provider === p)!
    expect(source('zhipu')!.stale).toBe(true)
    expect(source('anthropic')!.stale).toBe(false) // 验收:单厂家陈旧不牵连另一家
    expect(a.models).toHaveLength(TOTAL_BASELINE)
  })

  it('Anthropic 信源失败只标记该厂家陈旧:智谱档案与源状态不受影响', async () => {
    const { db } = openDb(':memory:')
    const svc = await makeService(db, makeDeps(ZHIPU_MD))
    await svc.pollZhipu()
    await svc.pollAnthropic()
    const failing = new ModelTrackingService(db, failingDeps())
    await expect(failing.pollAnthropic()).rejects.toThrow('HTTP 503')
    const a = await failing.archive()
    const source = (p: string) => a.sources.find((s) => s.provider === p)!
    expect(source('anthropic')!.stale).toBe(true)
    expect(source('zhipu')!.stale).toBe(false)
    // Anthropic 档案保留(基线在库),智谱动态不受影响
    expect((await byId(failing, 'claude-opus-5'))!.events.length).toBeGreaterThan(0)
    expect((await byId(failing, 'glm-5.3'))!.events.length).toBeGreaterThan(0)
  })

  it('基线幂等:init 两轮不重复建档(profile 刷新语义)', async () => {
    const { db } = openDb(':memory:')
    await makeService(db, makeDeps(''))
    await makeService(db, makeDeps(''))
    const svc = new ModelTrackingService(db, makeDeps(''))
    expect((await svc.archive()).models).toHaveLength(TOTAL_BASELINE)
  })
})

describe('模型追踪:路由', () => {
  it('GET /api/model-tracking/archive 需登录(401)且带登录态返回信封', async () => {
    const { db } = openDb(':memory:')
    await bootstrap(db, { username: 'admin', password: 'admin-pw' })
    const svc = await makeService(db, makeDeps(ZHIPU_MD))
    await svc.pollZhipu()
    await svc.pollAnthropic()
    await svc.pollXai() // 三源显式就位(sources 数确定,不靠 init 内未等待轮询的时序)
    const app = createApp({ db, modelTracking: svc })
    const anon = await app.request('/api/model-tracking/archive')
    expect(anon.status).toBe(401)
    const login = await app.request('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin-pw' }),
    })
    const cookie = login.headers.getSetCookie()[0]!.split(';')[0]!
    const res = await app.request('/api/model-tracking/archive', { headers: { cookie } })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { models: unknown[]; sources: unknown[] }
    expect(json.models).toHaveLength(TOTAL_BASELINE)
    expect(json.sources).toHaveLength(4)
  })
})

describe('模型追踪:Anthropic release notes 解析(纯函数)', () => {
  it('日期标题归一化:英文月份 + 序数后缀兼容,非法拒绝', () => {
    expect(normalizeAnthropicDate('August 5, 2026')).toBe('2026-08-05')
    expect(normalizeAnthropicDate('October 3rd, 2024')).toBe('2024-10-03')
    expect(normalizeAnthropicDate('February 1st, 2025')).toBe('2025-02-01')
    expect(normalizeAnthropicDate('Notamonth 5, 2026')).toBeNull()
    expect(normalizeAnthropicDate('August 32, 2026')).toBeNull()
    expect(normalizeAnthropicDate('')).toBeNull()
  })

  it('提取日期段条目:段名归一为日期、条目原文与链接按出现序', () => {
    const notes = parseAnthropicReleases(ANTHROPIC_MD)
    expect(notes).toHaveLength(6)
    expect(notes[0]).toMatchObject({ date: '2026-08-20' })
    expect(notes[0]!.links).toEqual(['https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/python'])
    // 序数后缀日期段(2024 年旧格式)正常解析
    expect(notes[5]).toMatchObject({ date: '2024-10-03' })
  })

  it('畸形日期段跳过,空文返回空数组', () => {
    expect(parseAnthropicReleases('')).toEqual([])
    expect(parseAnthropicReleases('### Someday 1, 2026\n* [x](https://a.b/c)')).toEqual([])
  })

  it('双条件归属:Opus 5/Fable 5 发布条目产事件;SDK、fast mode、弃用公告条目跳过', () => {
    const notes = parseAnthropicReleases(ANTHROPIC_MD)
    const opus5 = matchAnthropicEvent(notes[1]!)!
    expect(opus5.officialId).toBe('claude-opus-5')
    expect(opus5.event).toMatchObject({
      kind: 'updated',
      occurredOn: '2026-07-24',
      sourceUrl: 'https://platform.claude.com/docs/en/models/opus-5/whats-new-opus-5',
    })
    expect(opus5.event.title).toContain("We've launched **Claude Opus 5**")
    expect(matchAnthropicEvent(notes[0]!)).toBeNull() // Python SDK(平台功能)
    expect(matchAnthropicEvent(notes[2]!)).toBeNull() // fast mode 移除(链接不含 opus-4-7 slug)
    expect(matchAnthropicEvent(notes[4]!)).toBeNull() // Opus 4.1 弃用公告(链接为弃用表,退役口径归基线)
    expect(matchAnthropicEvent(notes[5]!)).toBeNull() // Haiku 3.5 产品页链接无本型号 slug
  })

  it('基线外型号不认领:仅限受邀项目(Project Glasswing)的 Mythos 条目不产动态', () => {
    const notes = parseAnthropicReleases(ANTHROPIC_MD)
    // Fable 5 与 Mythos 5 同条目:基线只认领 Fable 5,Mythos 无档案行
    expect(matchAnthropicEvent(notes[3]!)!.officialId).toBe('claude-fable-5')
    expect(ANTHROPIC_BASELINE.some((b) => b.officialId.includes('mythos'))).toBe(false)
  })

  it('词边界:「Claude Opus 4」不认领「Claude Opus 4.8」的条目,「claude-haiku-4-5」不认领 dated 快照链接', () => {
    const [note] = parseAnthropicReleases(
      "### July 1, 2026\n\n* Something new for Claude Opus 4.8. See [docs](https://platform.claude.com/docs/en/models/opus-4-8/overview).\n",
    )
    // 文本提 4.8、链接也是 4.8:应归 claude-opus-4-8,而非基线里的 claude-opus-4(词边界)
    expect(matchAnthropicEvent(note!)!.officialId).toBe('claude-opus-4-8')
    const [snapshot] = parseAnthropicReleases(
      "### July 2, 2026\n\n* Update for Claude Haiku 4.5. See [snapshot](https://platform.claude.com/docs/en/models/haiku-4-5-20251001/overview).\n",
    )
    // 家族 slug 尾边界不认领日期快照链接(dated URL 不自动归属,防误领)
    expect(matchAnthropicEvent(snapshot!)).toBeNull()
  })
})

describe('模型追踪:Anthropic 基线自身(issues/04)', () => {
  it('厂家归属:全部 provider=anthropic、officialId 唯一、kind 全为 text(视觉输入不另立记录)', () => {
    for (const b of ANTHROPIC_BASELINE) expect(b.provider).toBe('anthropic')
    expect(new Set(ANTHROPIC_BASELINE.map((b) => b.officialId)).size).toBe(ANTHROPIC_BASELINE.length)
    expect(new Set(ANTHROPIC_BASELINE.map((b) => b.kind))).toEqual(new Set<ModelKind>(['text']))
  })

  it('外部模型排除:无 embedding(推荐的外部 Voyage 不归入)、无审核/分类等非 text 行', () => {
    const ids = ANTHROPIC_BASELINE.map((b) => b.officialId).join(' ')
    expect(ids).not.toContain('voyage')
    expect(ANTHROPIC_BASELINE.filter((b) => b.kind !== 'text')).toEqual([])
    expect(ANTHROPIC_BASELINE.some((b) => b.kind === 'moderation_classification')).toBe(false)
  })

  it('固定型号识别:4.6 世代起无日期后缀 ID 即固定快照,直接入档;日期快照 ID 不另立行', () => {
    const ids = new Set(ANTHROPIC_BASELINE.map((b) => b.officialId))
    for (const dateless of ['claude-opus-4-6', 'claude-opus-4-7', 'claude-opus-4-8', 'claude-opus-5', 'claude-sonnet-4-6', 'claude-sonnet-5', 'claude-fable-5'])
      expect(ids.has(dateless)).toBe(true)
    expect([...ids].some((id) => /-20\d{6}$/.test(id))).toBe(false)
  })

  it('档案服务:Anthropic 全量入档、价格/限额落库、基线上线与退役动态共存', async () => {
    const { db } = openDb(':memory:')
    const svc = await makeService(db, makeDeps(''))
    const anthropic = (await svc.archive()).models.filter((m) => m.provider === 'anthropic')
    expect(anthropic).toHaveLength(16)
    const opus5 = anthropic.find((m) => m.officialId === 'claude-opus-5')!
    expect(opus5.pricing!.entries.map((e) => e.text)).toEqual([
      '输入 5 美元/百万 tokens',
      '输出 25 美元/百万 tokens',
    ])
    expect(opus5.limits).toEqual([
      { label: '上下文窗口', text: '1M', scope: null },
      { label: '最大输出', text: '128K', scope: null },
    ])
    expect(opus5.trainingParams).toBeNull() // Anthropic 未披露参数量
    const opus41 = anthropic.find((m) => m.officialId === 'claude-opus-4-1')!
    expect(opus41.stage).toBe('retired')
    expect(opus41.events.map((e) => e.kind).sort()).toEqual(['api_available', 'deprecated', 'retired'])
    // 退役模型在 Anthropic 行集内沉底(排序口径与全局一致)
    const firstRetired = anthropic.findIndex((m) => m.stage === 'retired')
    expect(firstRetired).toBeGreaterThan(0)
    expect(anthropic.slice(firstRetired).every((m) => m.stage === 'retired')).toBe(true)
  })

  it('历史去重:基线已核验的发布公告,自动解析不再补「updated」重复行', async () => {
    const { db } = openDb(':memory:')
    const svc = await makeService(db, makeDeps(ZHIPU_MD))
    await svc.pollAnthropic()
    await svc.pollAnthropic() // 两轮:同页幂等 + 基线事件在场
    const opus5 = await byId(svc, 'claude-opus-5')
    // 2026-07-24 公告只有基线 api_available 一条(无 'updated' 重复)
    expect(opus5!.events).toHaveLength(1)
    expect(opus5!.events[0]).toMatchObject({ kind: 'api_available', occurredOn: '2026-07-24' })
    const fable5 = await byId(svc, 'claude-fable-5')
    expect(fable5!.events).toHaveLength(1)
    expect(fable5!.events[0]!.kind).toBe('api_available')
  })

  it('自动解析仍能捕获基线未覆盖的新公告(kind=updated)', async () => {
    const { db } = openDb(':memory:')
    const md = `# Claude Platform release notes

### September 9, 2026

* [Claude Opus 5](https://platform.claude.com/docs/en/models/opus-5/overview) now supports a new output format. See [What's new](https://platform.claude.com/docs/en/models/opus-5/whats-new-opus-5) for details.
`
    const svc = await makeService(db, makeDeps({ [ZHIPU_RELEASES_URL]: '', [ANTHROPIC_RELEASES_URL]: md }))
    await svc.pollAnthropic()
    const opus5 = await byId(svc, 'claude-opus-5')
    expect(opus5!.events.map((e) => e.kind)).toEqual(['updated', 'api_available'])
  })
})

describe('模型追踪:xAI 发布流解析(纯函数,issues/05)', () => {
  it('月份/年份推断:当年标题不带年份按 currentYear,显式年份标题自锚;条目标题与正文首链(相对路径归一)提取', () => {
    const entries = parseXaiReleaseNotes(XAI_MD, 2026)
    expect(entries.map((e) => e.yearMonth)).toEqual([
      '2026-08', '2026-08',
      '2026-07', '2026-07',
      '2026-03',
      '2025-12',
    ])
    expect(entries[0]).toEqual({
      yearMonth: '2026-08',
      title: 'Grok 4.6',
      linkUrl: 'https://docs.x.ai/developers/grok-4-6',
    })
  })

  it('非月份 ## 段下的条目与月份段之前的散条目跳过;空文返回空数组', () => {
    expect(parseXaiReleaseNotes('', 2026)).toEqual([])
    expect(parseXaiReleaseNotes('## Notamonth\n\n### Stray entry\n\nbody', 2026)).toEqual([])
    expect(parseXaiReleaseNotes('### Before any month\n\nbody', 2026)).toEqual([])
  })

  it('标题归属:型号条目命中并锚定当月 1 日;产品条目(Grok Bot)与历史能力公告不产事件', () => {
    const entries = parseXaiReleaseNotes(XAI_MD, 2026)
    const byTitle = (t: string) => entries.find((e) => e.title === t)!
    expect(matchXaiEvent(byTitle('Grok 4.6'))).toEqual([
      {
        officialId: 'grok-4.6',
        event: {
          kind: 'updated',
          occurredOn: '2026-08-01',
          title: 'Grok 4.6',
          sourceUrl: 'https://docs.x.ai/developers/grok-4-6',
        },
      },
    ])
    expect(matchXaiEvent(byTitle('Grok Bot'))).toEqual([]) // 非模型条目
    expect(matchXaiEvent(byTitle('Grok Speech to Speech API is released'))).toEqual([]) // 能力 API 历史公告,不属于任一基线行
  })

  it('家族合并条目多命中:「Grok 4.20 and Grok 4.20 Multi-agent are live」同时命中 reasoning 与 multi-agent 两行', () => {
    const entries = parseXaiReleaseNotes(XAI_MD, 2026)
    const family = matchXaiEvent(entries.find((e) => e.yearMonth === '2026-03')!)
    expect(family.map((h) => h.officialId).sort()).toEqual(['grok-4.20-0309-reasoning', 'grok-4.20-multi-agent-0309'])
    expect(family[0]!.event.occurredOn).toBe('2026-03-01') // 月份粒度锚定当月 1 日
  })

  it('标题词边界:「grok-imagine-video-1.5 modalities」只命中 1.5 行,不误认 grok-imagine-video', () => {
    const entries = parseXaiReleaseNotes(XAI_MD, 2026)
    const v15 = entries.find((e) => e.title === 'grok-imagine-video-1.5 modalities')!
    expect(matchXaiEvent(v15).map((h) => h.officialId)).toEqual(['grok-imagine-video-1.5'])
  })
})

describe('模型追踪:xAI 基线自身(issues/05)', () => {
  it('多型号种类覆盖:文本/图像生成/视频生成/音频四类;provider/officialId 唯一', () => {
    expect(new Set(XAI_BASELINE.map((b) => b.kind))).toEqual(
      new Set(['text', 'image_generation', 'video_generation', 'audio_speech']),
    )
    for (const b of XAI_BASELINE) expect(b.provider).toBe('xai')
    expect(new Set(XAI_BASELINE.map((b) => b.officialId)).size).toBe(XAI_BASELINE.length)
  })

  it('移动别名不另立模型:基线无 -latest 行、无 grok-voice-latest;固定型号 -0309 是在售本体入档', () => {
    const ids = XAI_BASELINE.map((b) => b.officialId)
    expect(ids.some((id) => id.endsWith('-latest'))).toBe(false)
    expect(ids).not.toContain('grok-voice-latest')
    expect(ids).toContain('grok-4.20-0309-reasoning')
    expect(ids).toContain('grok-4.20-multi-agent-0309')
  })

  it('独立命名型号分别记录:Grok / Imagine / Voice 各系列齐备,Imagine Image 与 Video 分立', () => {
    const ids = XAI_BASELINE.map((b) => b.officialId)
    expect(ids).toContain('grok-4.6')
    expect(ids).toContain('grok-imagine-image-2.0')
    expect(ids).toContain('grok-imagine-video')
    expect(ids).toContain('grok-voice-think-fast-2.0')
    expect(ids).toContain('text-to-speech')
  })

  it('别名换指向与退役重定向作为动态保留,不改写原型号发布历史', async () => {
    const { db } = openDb(':memory:')
    const svc = await makeService(db, makeDeps(''))
    // think-fast-2.0:上线 + 别名换指向(grok-voice-latest → 本型号,官方明文 2026-08-05)
    const v2 = await byId(svc, 'grok-voice-think-fast-2.0')
    expect(v2!.events.map((e) => e.kind).sort()).toEqual(['alias_repointed', 'api_available'])
    expect(v2!.events.find((e) => e.kind === 'alias_repointed')).toMatchObject({ occurredOn: '2026-08-05' })
    // think-fast-1.0:原上线动态保留(2026-04-23 不被改写)+ deprecated 追加
    const v1 = await byId(svc, 'grok-voice-think-fast-1.0')
    expect(v1!.events.map((e) => e.kind).sort()).toEqual(['api_available', 'deprecated'])
    expect(v1!.events.find((e) => e.kind === 'api_available')!.occurredOn).toBe('2026-04-23')
    // 退役重定向:grok-code-fast-1 保留沉底行,retired 动态注明重定向去向
    const cf = await byId(svc, 'grok-code-fast-1')
    expect(cf!.stage).toBe('retired')
    expect(cf!.events).toHaveLength(1)
    expect(cf!.events[0]).toMatchObject({ kind: 'retired' })
  })
})

describe('模型追踪:xAI 档案服务(轮询/厂家隔离)', () => {
  it('pollXai:月份锚定 updated 动态入库,两轮幂等不翻倍', async () => {
    const { db } = openDb(':memory:')
    const svc = await makeService(db, makeDeps(''))
    await svc.pollXai()
    await svc.pollXai()
    const v2 = await byId(svc, 'grok-voice-think-fast-2.0')
    // 基线 2 条(api_available + alias_repointed)+ July 条目自动 updated(2026-07-01)
    expect(v2!.events.map((e) => e.kind).sort()).toEqual(['alias_repointed', 'api_available', 'updated'])
    expect(v2!.events.find((e) => e.kind === 'updated')).toMatchObject({ occurredOn: '2026-07-01' })
    const v15 = await byId(svc, 'grok-imagine-video-1.5')
    expect(v15!.events).toHaveLength(1)
    expect(v15!.events[0]).toMatchObject({ kind: 'updated', occurredOn: '2026-07-01' })
  })

  it('xAI 信源失败只标记该厂家陈旧:智谱/Anthropic 源与档案不受影响(issues/05 验收)', async () => {
    const { db } = openDb(':memory:')
    const svc = await makeService(db, makeDeps(ZHIPU_MD))
    await svc.pollZhipu()
    await svc.pollAnthropic()
    await svc.pollXai()
    const failing = new ModelTrackingService(db, failingDeps())
    await expect(failing.pollXai()).rejects.toThrow('HTTP 503')
    const a = await failing.archive()
    const source = (p: string) => a.sources.find((s) => s.provider === p)!
    expect(source('xai')!.stale).toBe(true)
    expect(source('zhipu')!.stale).toBe(false)
    expect(source('anthropic')!.stale).toBe(false)
    expect((await byId(failing, 'grok-4.6'))!.events.length).toBeGreaterThan(0) // xAI 档案保留
    expect((await byId(failing, 'glm-5.3'))!.events.length).toBeGreaterThan(0) // 智谱不受牵连
  })

  it('xAI 上游改版:200 但零结构化条目 → 抛错标陈旧,档案保留', async () => {
    const { db } = openDb(':memory:')
    const svc = await makeService(db, makeDeps({
      [ZHIPU_RELEASES_URL]: ZHIPU_MD,
      [ANTHROPIC_RELEASES_URL]: ANTHROPIC_MD,
      [XAI_RELEASES_URL]: '<html>上游改版了</html>',
    }))
    await svc.init()
    await expect(svc.pollXai()).rejects.toThrow('疑似上游改版')
    const a = await svc.archive()
    expect(a.sources.find((s) => s.provider === 'xai')!.stale).toBe(true)
    expect(a.models).toHaveLength(TOTAL_BASELINE)
  })
})

describe('模型追踪:xAI 基线信源一致性(评审修正)', () => {
  it('发布流口径的基线事件信源 = 轮询 URL(同公告去重键可对上,封堵 .md 分裂复发)', () => {
    for (const b of XAI_BASELINE) {
      for (const ev of b.events ?? []) {
        if (ev.sourceUrl.includes('docs.x.ai/developers/release-notes')) {
          expect(ev.sourceUrl).toBe(XAI_RELEASES_URL)
        }
      }
    }
  })
})

describe('模型追踪:DeepSeek Change Log 解析(纯函数;issues/07)', () => {
  it('提取日期段 h3 小节:日期/标题/锚点;页首非日期 h2 段(含其内 h3)整体跳过;实体还原', () => {
    const sections = parseDeepSeekUpdates(DEEPSEEK_HTML)
    expect(sections).toHaveLength(8)
    expect(sections[0]).toEqual({
      date: '2026-08-21',
      title: 'DeepSeek-V4-Flash-Vision-Exp Release',
      anchorUrl: 'https://api-docs.deepseek.com/updates/#deepseek-v4-flash-vision-exp-release',
    })
    // 2024-09-05 实抓标题含 &amp; → 还原为 &(锚点尾边界:不误吞 -model)
    const merged = sections.find((s) => s.title.includes('V2.5 Model'))!
    expect(merged.title).toBe('deepseek-coder & deepseek-chat Upgraded to DeepSeek V2.5 Model')
    expect(merged.anchorUrl).toBe('https://api-docs.deepseek.com/updates/#deepseek-coder--deepseek-chat-upgraded-to-deepseek-v25-model')
  })

  it('畸形日期段跳过,空文返回空数组', () => {
    expect(parseDeepSeekUpdates('')).toEqual([])
    expect(parseDeepSeekUpdates('<h2 id="x">Date: 2026-13-01</h2><h3 id="a">T</h3>')).toEqual([])
  })

  it('标题词边界归属:模型名小节归其行;家族段/别名标题段/非模型段跳过(正文提及不作证据)', () => {
    const sections = parseDeepSeekUpdates(DEEPSEEK_HTML)
    const byAnchor = (a: string) => sections.find((s) => s.anchorUrl.endsWith(a))!
    expect(matchDeepSeekEvent(byAnchor('deepseek-v4-pro-update'))).toEqual([
      {
        officialId: 'deepseek-v4-pro',
        event: {
          kind: 'updated',
          occurredOn: '2026-08-13',
          title: 'DeepSeek-V4-Pro Update',
          sourceUrl: 'https://api-docs.deepseek.com/updates/#deepseek-v4-pro-update',
        },
      },
    ])
    expect(matchDeepSeekEvent(byAnchor('deepseek-v4-flash-vision-exp-release')).map((h) => h.officialId)).toEqual(['deepseek-v4-flash-vision-exp'])
    // Vision-Exp 节正文提及「on par with DeepSeek-V4-Flash」——标题才作归属证据(否则误记 V4-Flash)
    expect(matchDeepSeekEvent(byAnchor('deepseek-v4'))).toEqual([]) // 家族段:非基线 alias,待核验线索
    expect(matchDeepSeekEvent(byAnchor('deepseek-chat'))).toEqual([]) // 别名标题段:史实由基线事件承载
    expect(matchDeepSeekEvent(byAnchor('new-api-features'))).toEqual([]) // 平台功能段
  })

  it('多命中:家族式双提标题同时归属两行(同 xAI 合并条目口径,不漏记半边)', () => {
    const hits = matchDeepSeekEvent({ date: '2026-09-01', title: 'DeepSeek-V4-Pro and DeepSeek-V4-Flash Update', anchorUrl: 'https://x/#c' })
    expect(hits.map((h) => h.officialId).sort()).toEqual(['deepseek-v4-flash', 'deepseek-v4-pro'])
  })

  it('词边界防误认领:「DeepSeek-V4-Flash」不认领 Vision-Exp 小节;「DeepSeek-V3.2」不认领 Speciale', () => {
    expect(
      matchDeepSeekEvent({ date: '2026-08-21', title: 'DeepSeek-V4-Flash-Vision-Exp Release', anchorUrl: 'https://x/#a' }).map((h) => h.officialId),
    ).not.toContain('deepseek-v4-flash')
    expect(
      matchDeepSeekEvent({ date: '2025-12-01', title: 'DeepSeek-V3.2-Speciale', anchorUrl: 'https://x/#b' }).map((h) => h.officialId),
    ).not.toContain('deepseek-v3.2')
  })
})

describe('模型追踪:DeepSeek 基线与服务(issues/07)', () => {
  it('基线形状:officialId 唯一;别名 ID(deepseek-chat/reasoner/coder)永不立行;种类不越研究核验范围(预告排除)', () => {
    const ids = DEEPSEEK_BASELINE.map((b) => b.officialId)
    expect(new Set(ids).size).toBe(DEEPSEEK_BASELINE.length)
    for (const alias of ['deepseek-chat', 'deepseek-reasoner', 'deepseek-coder']) {
      expect(ids).not.toContain(alias)
    }
    // 研究矩阵:DeepSeek 未见视频/音频/向量/重排/审核专用模型——出现即伪造
    for (const b of DEEPSEEK_BASELINE) {
      expect(b.kind === 'text' || b.kind === 'multimodal_understanding').toBe(true)
    }
    // 预告排除:非退役行必有现行渠道(纯论文/预告无渠道不立行)
    for (const b of DEEPSEEK_BASELINE) {
      if (b.stage !== 'retired') expect(b.availability.length).toBeGreaterThan(0)
    }
  })

  it('原 ID 升级留史:V4-Pro 一行三动态(权重→API→GA 原地升级),不覆盖不重复;init 幂等不翻倍', async () => {
    const { db } = openDb(':memory:')
    await makeService(db, makeDeps(''))
    await makeService(db, makeDeps('')) // 二轮 init(重启口径)
    const pro = await byId(new ModelTrackingService(db, makeDeps('')), 'deepseek-v4-pro')
    expect(pro!.events.map((e) => e.kind)).toEqual(['updated', 'api_available', 'weights_available']) // 日期倒序
    expect(pro!.events.map((e) => e.occurredOn)).toEqual(['2026-08-13', '2026-04-24', '2026-04-22'])
  })

  it('开放权重归属:Janus-Pro 单一主种类、summary 保留文生图能力事实、仅开放权重渠道(不标 API);V4 双系权重在档', async () => {
    const { db } = openDb(':memory:')
    const svc = await makeService(db, makeDeps(''))
    const janus = (await byId(svc, 'janus-pro'))!
    expect(janus.kind).toBe('multimodal_understanding')
    expect(janus.availability).toEqual(['open_weights'])
    expect(janus.summary).toContain('文生图')
    expect(janus.events.map((e) => e.kind)).toEqual(['weights_available'])
    expect((await byId(svc, 'deepseek-v4-pro'))!.availability).toContain('open_weights')
    expect((await byId(svc, 'deepseek-v4-flash'))!.availability).toContain('open_weights')
  })

  it('实验阶段:V4-Flash-Vision-Exp stage=experimental 且多模态理解种类;日期快照(0731/0813)归并不另立', async () => {
    const { db } = openDb(':memory:')
    const svc = await makeService(db, makeDeps(''))
    const vision = (await byId(svc, 'deepseek-v4-flash-vision-exp'))!
    expect(vision.kind).toBe('multimodal_understanding')
    expect(vision.stage).toBe('experimental')
    const ids = new Set((await svc.archive()).models.map((m) => m.officialId))
    expect(ids.has('deepseek-v4-flash-0731')).toBe(false)
    expect(ids.has('deepseek-v4-pro-0813')).toBe(false)
  })

  it('退役沉底与官方披露:历史八代 retired 且权重渠道保留;官方卡片参数量结构化,未披露为 null', async () => {
    const { db } = openDb(':memory:')
    const svc = await makeService(db, makeDeps(''))
    const a = await svc.archive()
    const retired = a.models.filter((m) => m.provider === 'deepseek' && m.stage === 'retired')
    expect(retired.map((m) => m.officialId).sort()).toEqual([
      'deepseek-coder-v2', 'deepseek-r1', 'deepseek-v2', 'deepseek-v2.5', 'deepseek-v3', 'deepseek-v3.1', 'deepseek-v3.2', 'deepseek-v3.2-speciale',
    ])
    for (const id of ['deepseek-v2', 'deepseek-v3', 'deepseek-r1', 'deepseek-v3.1', 'deepseek-v3.2', 'deepseek-v2.5', 'deepseek-coder-v2']) {
      expect((await byId(svc, id))!.availability).toContain('open_weights')
    }
    expect((await byId(svc, 'deepseek-v3'))!.trainingParams).toEqual({ total: '671B', active: '37B' })
    expect((await byId(svc, 'deepseek-r1'))!.trainingParams).toEqual({ total: '671B', active: '37B' })
    expect((await byId(svc, 'deepseek-v2'))!.trainingParams).toEqual({ total: '236B', active: '21B' })
    expect((await byId(svc, 'deepseek-coder-v2'))!.trainingParams).toEqual({ total: '236B', active: '21B' })
    expect((await byId(svc, 'deepseek-v4-pro'))!.trainingParams).toBeNull()
    expect((await byId(svc, 'deepseek-v3.2'))!.trainingParams).toBeNull() // 卡片未单独披露,不以同架构推算补空
    expect((await byId(svc, 'janus-pro'))!.trainingParams).toBeNull() // 1B/7B 双规格不混记
  })

  it('陈旧降级:DeepSeek 源失败只标记 deepseek 陈旧、档案保留且他厂不受牵连;零小节 = 上游改版同口径', async () => {
    const { db } = openDb(':memory:')
    const svc = await makeService(db, makeDeps(ZHIPU_MD)) // 单字符串:智谱页实文,DeepSeek 页用固定夹具
    await svc.pollDeepSeek()
    const failing = new ModelTrackingService(db, failingDeps())
    await expect(failing.pollDeepSeek()).rejects.toThrow('HTTP 503')
    let a = await failing.archive()
    expect(a.sources.find((s) => s.provider === 'deepseek')!.stale).toBe(true)
    expect((await byId(failing, 'deepseek-v4-pro'))!.events.length).toBeGreaterThan(0) // 档案保留
    expect(a.sources.find((s) => s.provider === 'zhipu')!.stale).toBe(false)
    const drifty = new ModelTrackingService(db, makeDeps({ [DEEPSEEK_UPDATES_URL]: '<html>redesigned</html>' }))
    await expect(drifty.pollDeepSeek()).rejects.toThrow('疑似上游改版')
    a = await drifty.archive()
    expect(a.models.filter((m) => m.provider === 'deepseek')).toHaveLength(DEEPSEEK_BASELINE.length)
  })

  it('同公告去重:基线事件已占 (模型,日期,锚点) 键,poll 不补 updated 重复行;新公告自动入库', async () => {
    const { db } = openDb(':memory:')
    const md = `${DEEPSEEK_HTML}<h2 id="date-2026-09-09">Date: 2026-09-09</h2><h3 id="deepseek-v4-pro-price">DeepSeek-V4-Pro Price Cut</h3>\n`
    const svc = await makeService(db, makeDeps({ [DEEPSEEK_UPDATES_URL]: md }))
    await svc.pollDeepSeek()
    await svc.pollDeepSeek() // 两轮幂等
    const pro = (await byId(svc, 'deepseek-v4-pro'))!
    expect(pro.events).toHaveLength(4) // 权重/API/GA 三条基线 + 1 条新公告
    expect(pro.events.find((e) => e.occurredOn === '2026-08-13')!.kind).toBe('updated') // GA 公告未被覆盖
    expect(pro.events[0]).toMatchObject({ kind: 'updated', occurredOn: '2026-09-09', title: 'DeepSeek-V4-Pro Price Cut' })
  })
})
