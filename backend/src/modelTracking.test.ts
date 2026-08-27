import { describe, expect, it, vi } from 'vitest'
import type { ModelKind } from 'chrome-tab-shared'
import { SINGLETON_TYPES, TYPE_SPANS } from './icons'
import { createApp } from './app'
import { bootstrap } from './seed'
import { openDb, type Db } from './db'
import {
  ANTHROPIC_BASELINE,
  ANTHROPIC_RELEASES_URL,
  KIMI_BASELINE,
  KIMI_BLOG_URL,
  KIMI_NEWS_URL,
  ModelTrackingService,
  OPENAI_BASELINE,
  OPENAI_CHANGELOG_URL,
  XAI_BASELINE,
  XAI_RELEASES_URL,
  ZHIPU_BASELINE,
  ZHIPU_RELEASES_URL,
  matchAnthropicEvent,
  matchKimiEvent,
  matchOpenAIEvents,
  matchXaiEvent,
  matchZhipuEvent,
  normalizeAnthropicDate,
  normalizeZhipuDate,
  parseAnthropicReleases,
  parseKimiArticles,
  parseOpenAIChangelog,
  parseXaiReleaseNotes,
  parseZhipuReleases,
  resolveOpenAIModelId,
  type ModelTrackingDeps,
} from './modelTracking'
import {
  DEEPSEEK_BASELINE,
  DEEPSEEK_UPDATES_URL,
  matchDeepSeekEvent,
  parseDeepSeekUpdates,
} from './deepseekBaseline'
import {
  QWEN_BASELINE,
  QWEN_RELEASES_URL,
  matchQwenEvents,
  parseBailianReleases,
  resolveQwenModelId,
} from './qwenBaseline'

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
 * OpenAI API changelog 快照节选(2026-08-25 实抓口径:`## 月份, 年`/`### 缩写日` 两级
 * 标题、类型行 `Feature · Model: id` 自带结构化模型 ID;同日双条目与无模型条目并存,
 * 尾部一个非日期 `###` 标题验证保守清空日期上下文)。
 */
const OPENAI_MD = `# Changelog

## August, 2026

### Aug 21

Update · Model: gpt-5.6-sol

GPT-5.6 Sol now costs $4 per million input tokens and $20 per million output tokens.

### Aug 21

Feature

Released the Prompt Caching dashboard.

## July, 2026

### Jul 9

Feature · Model: gpt-5.6-sol · Model: gpt-5.6-terra · Model: gpt-5.6-luna

Released the GPT-5.6 model family, including Sol, Terra, and Luna.

### Jul 6

Feature · Model: gpt-realtime-2.1 · Model: gpt-realtime-2.1-mini

Released GPT-Realtime-2.1, an updated realtime reasoning model.

### Non-date Heading

Update · Model: gpt-image-2

透明背景支持(无日期上下文,应被跳过)。
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
 * 按 URL 分发页面。单字符串 = 智谱页内容 + 其余厂家页固定夹具(既有单厂家用例下
 * 各轮询都成功且行为确定);Record 原样分发,未列出的 URL 抛错。
 */
/**
 * 百炼「模型上下架与更新」首表快照节选(2026-08-26 实抓口径:表头 `<th>` 行、时间列
 * 零填充(含一行不补零防御)、多 ID 单元格多 `<p><code>`、中西文间距 span、第三方
 * 托管行(kimi-k3/vidu)、无版本别名行;末尾附第二张表验「只取首表」)。
 */
const QWEN_HTML = `<table>
<tr><th>模型类型</th><th>时间</th><th>模型ID</th><th>功能说明</th></tr>
<tr><td>图片生成</td><td>2026-08-24</td><td><p><code>vidu/vidu-image-pro_reference2image</code></p></td><td>第三方托管模型,不认领</td></tr>
<tr><td>视频生成</td><td>2026-08-20</td><td><p><code>wan3.0-video-prime</code></p></td><td>Wan3.0-Video-Prime 是万相 3.0 的高速版视频生成模型</td></tr>
<tr><td>文本生成、深度思考</td><td>2026-8-2</td><td><p><code>qwen3.8-max</code></p></td><td>Qwen3.8-Max 是 2.4 万亿参数 MoE 旗舰模型<span class="help-letter-space"></span>编程与办公能力全面跃升</td></tr>
<tr><td>文本生成</td><td>2026-07-15</td><td><p><code>qwen3.7-flash</code></p><p><code>qwen3.7-flash-2026-07-15</code></p></td><td>Qwen3.7-Flash 高性价比模型(主线+快照同格)</td></tr>
<tr><td>文本生成</td><td>2026-08-24</td><td><p><code>kimi-k3</code></p></td><td>第三方托管模型,不认领</td></tr>
<tr><td>文本生成</td><td>2026-08-10</td><td><p><code>qwen-plus</code></p><p><code>qwen-plus-latest</code></p></td><td>动态更新版本,模型更新不会提前通知(无版本别名)</td></tr>
</table>
<table>
<tr><td>文本生成</td><td>2020-01-01</td><td><p><code>qwen3.8-max</code></p></td><td>hydration 拷贝表,不应被解析</td></tr>
</table>`

function makeDeps(md: string | Record<string, string>): ModelTrackingDeps {
  const pages: Record<string, string> =
    typeof md === 'string'
      ? {
          [ZHIPU_RELEASES_URL]: md,
          [ANTHROPIC_RELEASES_URL]: ANTHROPIC_MD,
          [XAI_RELEASES_URL]: XAI_MD,
          [OPENAI_CHANGELOG_URL]: OPENAI_MD,
          [KIMI_NEWS_URL]: KIMI_NEWS_HTML,
          [KIMI_BLOG_URL]: KIMI_BLOG_HTML,
          [DEEPSEEK_UPDATES_URL]: DEEPSEEK_HTML,
          [QWEN_RELEASES_URL]: QWEN_HTML,
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

/** 各厂家基线总行数(init 入档的期望值;含并行会话已接线进 ALL_BASELINES 的厂家)。 */
const TOTAL_BASELINE =
  ZHIPU_BASELINE.length + ANTHROPIC_BASELINE.length + XAI_BASELINE.length + KIMI_BASELINE.length + OPENAI_BASELINE.length + DEEPSEEK_BASELINE.length + QWEN_BASELINE.length

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

  it('家族 Flash 变体独立认领:GLM-5.3-Flash 块归 glm-5.3-flash 而非家族行 glm-5.3', () => {
    // 回归(2026-08-27 漏检事故):GLM-5.3-Flash 08-26 上线,块被家族 alias 词边界
    // 正确排除(「GLM-5.3」不认领「GLM-5.3-Flash」)后须由独立基线行认领——
    // 基线缺行时整块静默跳过,即用户症状「新模型没检测到」。fixture 为发布页原文。
    const [u] = parseZhipuReleases(
      '<Update label="2026-08-26" description="GLM-5.3-Flash 原生多模态模型上线">\n  👀 [**GLM-5.3-Flash**](/cn/guide/models/vlm/glm-5.3-flash)\n</Update>',
    )
    expect(matchZhipuEvent(u!)).toEqual({
      officialId: 'glm-5.3-flash',
      event: {
        kind: 'updated',
        occurredOn: '2026-08-26',
        title: 'GLM-5.3-Flash 原生多模态模型上线',
        sourceUrl: 'https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash',
      },
    })
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

  it('已退役模型入档且 stage=retired、排序沉底(期望自基线推导——新厂家票扩清单不再改此处)', async () => {
    const { db } = openDb(':memory:')
    const svc = await makeService(db, makeDeps(ZHIPU_MD))
    const a = await svc.archive()
    const retired = a.models.filter((m) => m.stage === 'retired')
    const expected = [
      ...ZHIPU_BASELINE, ...ANTHROPIC_BASELINE, ...XAI_BASELINE, ...KIMI_BASELINE,
      ...OPENAI_BASELINE, ...DEEPSEEK_BASELINE,
    ]
      .filter((b) => b.stage === 'retired')
      .map((b) => b.officialId)
      .sort()
    expect(retired.map((m) => m.officialId).sort()).toEqual(expected)
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

  it('待核验线索:基线外块落线索库、30 天窗口挡历史块、幂等不翻倍、7 天未见滚出读侧', async () => {
    // 回归(2026-08-27 千问/智谱漏检):ADR-0025「跳过待核验」不再静默——基线外
    // 块须落 model_pending_clues 可见。时间钉 2026-03-01:GLM-9.9 块(02-03)落
    // 30 天窗内,Vidu 块(2025-06-18)被窗口挡掉(滚动信源的历史块非漏检信号)。
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-01T02:41:00Z'))
    try {
      const { db } = openDb(':memory:')
      const svc = await makeService(db, makeDeps(ZHIPU_MD))
      await svc.pollZhipu()
      const clueTitles = async () => (await svc.archive()).pendingClues.map((c) => c.title)
      expect((await clueTitles()).some((t) => t.includes('GLM-9.9'))).toBe(true)
      expect((await clueTitles()).some((t) => t.includes('Vidu'))).toBe(false)
      await svc.pollZhipu() // 二轮幂等:同行不翻倍
      expect((await clueTitles()).filter((t) => t.includes('GLM-9.9'))).toHaveLength(1)
      // 模拟条目从页面消失:last_seen_at 停更 8 天 → 滚出读侧(基线收录自愈同路径)
      await db
        .updateTable('model_pending_clues')
        .set({ last_seen_at: new Date(Date.now() - 8 * 86400_000).toISOString() })
        .where('title', 'like', '%GLM-9.9%')
        .execute()
      expect((await clueTitles()).some((t) => t.includes('GLM-9.9'))).toBe(false)
    } finally {
      vi.useRealTimers()
    }
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
    await svc.pollXai()
    await svc.pollOpenAI()
    await svc.pollMoonshot()
    await svc.pollDeepSeek()
    await svc.pollAlibaba() // 七源显式就位(sources 数确定,不靠 init 内未等待轮询的时序)
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
    expect(json.sources).toHaveLength(7)
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

/**
 * 月之暗面资讯/Blog 快照节选(2026-08-25 实抓结构口径:覆盖整卡的 aria-label 锚点 +
 * card-title + 其后日期;头图 URL 常含与发布日不同的上传日期——解析必须取 card-title
 * 之后的日期;混有非模型文章(大使计划/Work 上新/PerceptionBench/Kimi-VL)与无日期卡)。
 */
const card = (href: string, title: string, date: string | null, imgDate = '2026-08-11') => `
<div class="menu-card group relative flex flex-col">
  <a href="${href}" aria-label="${title}" class="absolute inset-0 z-[1] rounded-xl"></a>
  <div class="card-media w-full overflow-hidden rounded-lg aspect-video"><img alt="${title}" src="https://kimi-file.kimi.ai/prod-chat-kimi/kfs/4/2/${imgDate}/cover"></div>
  <div class="flex flex-col card-body gap-2.5 px-4">
    <h4 class="card-title text-xl font-semibold">${title}</h4>
    ${date === null ? '' : `<p class="card-date text-base">${date}</p>`}
  </div>
</div>`

const KIMI_NEWS_HTML = `<!-- Kimi 资讯(2026-08-25 实抓节选)-->
${card('/news/kimi-ambassador-program', 'Kimi 全球大使计划现已开启', '2026-07-28')}
${card('/news/kimi-k3-open-source', 'Kimi K3 开放日:模型权重、技术报告和关键 Infra 技术同步开放', '2026-07-27')}
${card('/news/kimi-k3', 'Kimi K3:智能的新前沿', '2026-07-17')}
${card('/news/kimi-work-update', 'Kimi Work 上新:目标模式、插件中心和 6 月限时福利', '2026-06-18')}
`

const KIMI_BLOG_HTML = `<!-- Kimi Blog 索引(2026-08-25 实抓节选;首卡为头图卡,与列表卡同 URL 重复)-->
${card('/en/blog/kimi-k3', 'Kimi K3', '2026-07-16')}
${card('/en/blog/kimi-k3', 'Kimi K3', '2026-07-16')}
${card('/en/blog/perception-bench', 'PerceptionBench', '2026-07-16')}
${card('/en/blog/kimi-k2-6', 'Kimi K2.6', '2026-04-20')}
${card('/en/blog/kimi-k2-5', 'Kimi K2.5', '2026-01-27')}
${card('/en/blog/kimi-k2-thinking', 'Kimi K2 Thinking', '2025-11-06')}
${card('https://huggingface.co/MoonshotAI/Kimi-K2-Instruct-0905', 'Kimi-K2-Instruct-0905', '2025-09-05')}
${card('/en/blog/kimi-k2', 'Kimi K2', '2025-07-11')}
${card('https://github.com/MoonshotAI/Kimi-Audio', 'Kimi-Audio', '2025-04-26')}
${card('https://github.com/MoonshotAI/Kimi-VL', 'Kimi-VL', '2025-04-10')}
${card('/en/blog/kimi-k4-teaser', 'Kimi K4 预告', null)}
`

describe('模型追踪:月之暗面资讯/Blog 解析(纯函数,issues/06)', () => {
  it('卡片提取:aria-label 标题 + card-title 之后的日期;相对链接归一到 www.kimi.com', () => {
    const news = parseKimiArticles(KIMI_NEWS_HTML)
    expect(news).toHaveLength(4)
    expect(news[2]).toEqual({
      url: 'https://www.kimi.com/news/kimi-k3',
      title: 'Kimi K3:智能的新前沿',
      date: '2026-07-17',
    })
    const blog = parseKimiArticles(KIMI_BLOG_HTML)
    // 头图卡与列表卡同 URL 去重;无日期卡(K4 预告)跳过
    expect(blog).toHaveLength(9)
    expect(blog.filter((a) => a.url === 'https://www.kimi.com/en/blog/kimi-k3')).toHaveLength(1)
    expect(blog.some((a) => a.title.includes('K4'))).toBe(false)
    // 外链(研究卡片直链 GitHub/HF)保持绝对 URL 原样
    expect(blog.at(-1)!.url).toBe('https://github.com/MoonshotAI/Kimi-VL')
  })

  it('日期取 card-title 之后的首个 ISO 日期:头图 URL 里的上传日期(2026-08-11)不误作发布日', () => {
    const news = parseKimiArticles(KIMI_NEWS_HTML)
    // 07-27 文章配 08-11 头图(实抓口径)——若取窗口内首个日期会错记 2026-08-11
    expect(news.find((a) => a.url.endsWith('kimi-k3-open-source'))!.date).toBe('2026-07-27')
  })

  it('上游改版:无卡片锚点 → 空数组(pollOne 零条目口径)', () => {
    expect(parseKimiArticles('<html>上游改版了</html>')).toEqual([])
  })

  it('标题归属:非模型文章(大使计划/Work 上新/PerceptionBench/Kimi-VL)不产事件', () => {
    const news = parseKimiArticles(KIMI_NEWS_HTML)
    expect(matchKimiEvent(news.find((a) => a.title.includes('大使计划'))!)).toBeNull()
    expect(matchKimiEvent(news.find((a) => a.title.includes('Work 上新'))!)).toBeNull()
    const blog = parseKimiArticles(KIMI_BLOG_HTML)
    expect(matchKimiEvent(blog.find((a) => a.title === 'PerceptionBench')!)).toBeNull()
    expect(matchKimiEvent(blog.find((a) => a.title === 'Kimi-VL')!)).toBeNull()
    // 「Kimi K3 开放日」是 K3 的权重开放公告——归属 K3 本身(基线 weights_available 占同键)
    expect(matchKimiEvent(news.find((a) => a.url.endsWith('kimi-k3-open-source'))!)!.officialId).toBe('kimi-k3')
  })

  it('最长 alias 优先:「Kimi K2 Thinking」标题不误归属「Kimi K2」', () => {
    const hit = matchKimiEvent({ url: 'https://www.kimi.com/en/blog/kimi-k2-thinking', title: 'Kimi K2 Thinking', date: '2025-11-06' })
    expect(hit!.officialId).toBe('kimi-k2-thinking')
  })

  it('词边界:「Kimi K2」不认领「Kimi K2.5」的标题', () => {
    expect(matchKimiEvent({ url: 'https://www.kimi.com/news/x', title: 'Kimi K2.5 视觉能力升级', date: '2026-02-02' })!.officialId).toBe('kimi-k2.5')
    expect(matchKimiEvent({ url: 'https://www.kimi.com/news/y', title: 'Kimi K3.5 发布预告', date: '2026-09-09' })).toBeNull()
  })
})

describe('模型追踪:月之暗面基线自身(issues/06)', () => {
  it('商业/API 与开放权重归属:K3/K2.7 Code/K2.6/K2.5 双渠道;Kimi-Audio 仅开放权重,不反向标成 API 可用', () => {
    const byId = new Map(KIMI_BASELINE.map((b) => [b.officialId, b]))
    expect(byId.get('kimi-k3')!.availability).toEqual(['api', 'open_weights'])
    expect(byId.get('kimi-k2.7-code')!.availability).toEqual(['api', 'open_weights'])
    expect(byId.get('kimi-k2.7-code-highspeed')!.availability).toEqual(['api']) // 高速服务档无独立权重
    expect(byId.get('kimi-audio')!.availability).toEqual(['open_weights']) // 研究红线:不在商业 API
    expect(new Set(KIMI_BASELINE.map((b) => b.officialId)).size).toBe(KIMI_BASELINE.length)
    for (const b of KIMI_BASELINE) expect(b.provider).toBe('moonshot')
  })

  it('退役模型渠道:API 随下线清空、开放权重保留(评审修正,同 GLM-Z1 availability=[] 先例)', () => {
    const byId = new Map(KIMI_BASELINE.map((b) => [b.officialId, b]))
    expect(byId.get('kimi-k2')!.availability).toEqual(['open_weights'])
    expect(byId.get('kimi-k2-thinking')!.availability).toEqual(['open_weights'])
    expect(byId.get('kimi-thinking-preview')!.availability).toEqual([]) // API 专属,下线即无渠道
  })

  it('预告/非模型排除:Infra 组件(MoonEP 等)、研究仓(Kimi-VL/Kimi-Dev/Kimi-Linear/Moonlight)、移动别名(kimi-latest)不在基线', () => {
    const ids = new Set(KIMI_BASELINE.map((b) => b.officialId))
    for (const excluded of ['moonep', 'flashkda', 'agentenv', 'kimi-vl', 'kimi-dev', 'kimi-linear', 'moonlight', 'kimi-latest']) {
      expect([...ids].some((id) => id.includes(excluded))).toBe(false)
    }
  })

  it('快照归并:0905 是 kimi-k2 家族行的动态而非独立模型;moonshot-v1 vision 变体独立成行(种类不同)', () => {
    const k2 = KIMI_BASELINE.find((b) => b.officialId === 'kimi-k2')!
    expect(k2.events!.map((e) => e.kind).sort()).toEqual(['retired', 'updated', 'weights_available'])
    expect(KIMI_BASELINE.find((b) => b.officialId === 'moonshot-v1')!.kind).toBe('text')
    expect(KIMI_BASELINE.find((b) => b.officialId === 'moonshot-v1-vision')!.kind).toBe('multimodal_understanding')
  })

  it('训练参数量结构化:K2 为 1T/32B(MoE 分记),K3 总量 2.8万亿、激活未披露为 null', () => {
    expect(KIMI_BASELINE.find((b) => b.officialId === 'kimi-k2')!.trainingParams).toEqual({ total: '1T', active: '32B' })
    expect(KIMI_BASELINE.find((b) => b.officialId === 'kimi-k3')!.trainingParams).toEqual({ total: '2.8万亿', active: null })
  })

  it('退役保留与沉底:kimi-k2 系列与 kimi-thinking-preview 均 stage=retired 且排在可用模型之后', async () => {
    const { db } = openDb(':memory:')
    const svc = await makeService(db, makeDeps(''))
    const a = await svc.archive()
    const retired = a.models.filter((m) => m.provider === 'moonshot' && m.stage === 'retired').map((m) => m.officialId).sort()
    expect(retired).toEqual(['kimi-k2', 'kimi-k2-thinking', 'kimi-thinking-preview'])
    const firstRetired = a.models.findIndex((m) => m.stage === 'retired')
    expect(a.models.slice(firstRetired).every((m) => m.stage === 'retired')).toBe(true)
  })

  it('基线事件信源 = 官方文章 URL(与轮询解析的卡片 URL 同键,同公告不产重复动态)', () => {
    const urls = new Set([
      'https://www.kimi.com/news/kimi-k3',
      'https://www.kimi.com/news/kimi-k3-open-source',
      'https://www.kimi.com/en/blog/kimi-k2-6',
      'https://www.kimi.com/en/blog/kimi-k2-5',
      'https://www.kimi.com/en/blog/kimi-k2-thinking',
      'https://www.kimi.com/en/blog/kimi-k2',
      'https://huggingface.co/MoonshotAI/Kimi-K2-Instruct-0905',
      'https://github.com/MoonshotAI/Kimi-Audio',
    ])
    for (const b of KIMI_BASELINE) {
      for (const ev of b.events ?? []) {
        if (ev.kind === 'retired') continue // 下线口径出自模型列表页,不与文章卡对键
        expect(urls.has(ev.sourceUrl)).toBe(true)
      }
    }
  })
})

describe('模型追踪:月之暗面档案服务(轮询/去重/陈旧,issues/06)', () => {
  const kimiDeps = (news: string | Error = KIMI_NEWS_HTML, blog: string | Error = KIMI_BLOG_HTML): ModelTrackingDeps => ({
    fetchText: async (url) => {
      if (url === KIMI_NEWS_URL) return news instanceof Error ? Promise.reject(news) : news
      if (url === KIMI_BLOG_URL) return blog instanceof Error ? Promise.reject(blog) : blog
      throw new Error('HTTP 404')
    },
  })

  it('pollMoonshot:基线已核验的公告不产重复动态;基线未覆盖的新文章(技术博客)自动入库 updated', async () => {
    const { db } = openDb(':memory:')
    const svc = await makeService(db, kimiDeps())
    await svc.pollMoonshot()
    await svc.pollMoonshot() // 两轮幂等
    const k3 = await byId(svc, 'kimi-k3')
    // 资讯发布(07-17 基线占键)+ 开放日(07-27 基线占键)+ 技术博客(07-16 自动解析)
    expect(k3!.events.map((e) => [e.kind, e.occurredOn]).sort()).toEqual([
      ['api_available', '2026-07-17'],
      ['updated', '2026-07-16'],
      ['weights_available', '2026-07-27'],
    ])
    // 博客上的 K2.5/K2.6/K2-Thinking/K2/0905/Kimi-Audio 卡片全部被基线事件占键:
    // 事件数 = 基线条数(自动解析一条未加)
    for (const [id, n] of [
      ['kimi-k2.5', 1],
      ['kimi-k2.6', 1],
      ['kimi-k2-thinking', 2],
      ['kimi-k2', 3],
      ['kimi-audio', 1],
    ] as const) {
      expect((await byId(svc, id))!.events).toHaveLength(n)
    }
    const a = await svc.archive()
    expect(a.sources.find((s) => s.provider === 'moonshot')).toMatchObject({ stale: false, lastSuccessAt: expect.any(String) })
  })

  it('单页失败标陈旧并上抛,另一页动态照常入库;恢复后陈旧清除', async () => {
    const { db } = openDb(':memory:')
    const svc = await makeService(db, kimiDeps())
    await svc.pollMoonshot()
    const halfFailing = new ModelTrackingService(db, kimiDeps(new Error('HTTP 503'), KIMI_BLOG_HTML))
    await expect(halfFailing.pollMoonshot()).rejects.toThrow('HTTP 503')
    let a = await halfFailing.archive()
    expect(a.sources.find((s) => s.provider === 'moonshot')!.stale).toBe(true)
    expect((await byId(halfFailing, 'kimi-k3'))!.events.length).toBeGreaterThan(0) // 档案与已入动态保留
    const ok = new ModelTrackingService(db, kimiDeps())
    await ok.pollMoonshot()
    a = await ok.archive()
    expect(a.sources.find((s) => s.provider === 'moonshot')!.stale).toBe(false)
  })

  it('上游改版:200 但零卡片 → 抛错标陈旧,既有档案保留', async () => {
    const { db } = openDb(':memory:')
    const svc = await makeService(db, kimiDeps())
    await svc.pollMoonshot()
    const drifty = new ModelTrackingService(db, kimiDeps('<html>上游改版了</html>', '<html>上游改版了</html>'))
    await expect(drifty.pollMoonshot()).rejects.toThrow('疑似上游改版')
    const a = await drifty.archive()
    expect(a.sources.find((s) => s.provider === 'moonshot')!.stale).toBe(true)
    expect(a.models.filter((m) => m.provider === 'moonshot')).toHaveLength(KIMI_BASELINE.length)
  })

  it('月之暗面信源失败不牵连其他厂家(厂家隔离)', async () => {
    const { db } = openDb(':memory:')
    // 不经 init(其内未等待的并行轮询会与本测试的显式失败轮询竞争写 sources 行)
    const svc = new ModelTrackingService(db, makeDeps(ZHIPU_MD))
    await svc.pollZhipu() // 智谱源就位
    const failing = new ModelTrackingService(db, kimiDeps(new Error('HTTP 503'), new Error('HTTP 503')))
    await expect(failing.pollMoonshot()).rejects.toThrow('HTTP 503')
    const a = await failing.archive()
    expect(a.sources.find((s) => s.provider === 'moonshot')!.stale).toBe(true)
    expect(a.sources.find((s) => s.provider === 'zhipu')!.stale).toBe(false)
  })
})

describe('模型追踪:OpenAI changelog 解析(纯函数,issues/03)', () => {
  it('提取条目:月/日两级标题合成日期,类型行 Model: 字段逐段提取,正文首行为标题', () => {
    const entries = parseOpenAIChangelog(OPENAI_MD)
    // 5 个类型行,但 Non-date Heading 后的条目无日期上下文 → 4 条
    expect(entries).toHaveLength(4)
    expect(entries[0]).toMatchObject({
      date: '2026-08-21',
      models: ['gpt-5.6-sol'],
      firstLine: 'GPT-5.6 Sol now costs $4 per million input tokens and $20 per million output tokens.',
    })
    expect(entries[1]).toMatchObject({ date: '2026-08-21', models: [] }) // Feature 无模型条目
    expect(entries[2]).toMatchObject({
      date: '2026-07-09',
      models: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'],
    })
  })

  it('空文返回空数组;非日期 ### 标题保守清空日期上下文(后续条目跳过)', () => {
    expect(parseOpenAIChangelog('')).toEqual([])
    const entries = parseOpenAIChangelog(OPENAI_MD)
    expect(entries.at(-1)).toMatchObject({ date: '2026-07-06' }) // Non-date Heading 后的 gpt-image-2 条目未成为第 5 条
  })

  it('归属解析:精确 alias 优先(gpt-5.2-codex 不被 gpt-5.2 认领),日期快照最长前缀归族', () => {
    expect(resolveOpenAIModelId('gpt-5.2-codex')).toBe('gpt-5.2-codex')
    expect(resolveOpenAIModelId('gpt-image-2-2026-04-21')).toBe('gpt-image-2')
    expect(resolveOpenAIModelId('gpt-4o-mini-transcribe-2025-12-15')).toBe('gpt-4o-mini-transcribe')
    expect(resolveOpenAIModelId('sora-2-2025-10-06')).toBe('sora-2')
    // 移动别名不在基线 → null(移动别名、latest 与日期快照不另占一行,issues/03)
    for (const id of ['chat-latest', 'daybreak-red-latest', 'daybreak-blue-latest', 'gpt-5.3-chat-latest', 'chatgpt-image-latest']) {
      expect(resolveOpenAIModelId(id)).toBeNull()
    }
  })

  it('条目 → 事件:一表多模型各产一条、同键同锚点;无模型条目与基线外别名条目不产事件', () => {
    const events = matchOpenAIEvents(parseOpenAIChangelog(OPENAI_MD))
    expect(events.map((e) => e.officialId)).toEqual([
      'gpt-5.6-sol',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'gpt-realtime-2.1',
      'gpt-realtime-2.1-mini',
    ])
    expect(events[2]!.event).toMatchObject({
      kind: 'updated',
      occurredOn: '2026-07-09',
      sourceUrl: 'https://developers.openai.com/api/docs/changelog#jul-9',
    })
  })
})

describe('模型追踪:OpenAI 基线自身(issues/03)', () => {
  it('官方目录种类映射:六类入档(目录无独立 rerank;GPT 主线图像输入是能力非种类),provider/officialId 唯一', () => {
    const kinds = new Set(OPENAI_BASELINE.map((b) => b.kind))
    expect(kinds).toEqual(
      new Set(['text', 'audio_speech', 'image_generation', 'video_generation', 'embedding', 'moderation_classification']),
    )
    for (const b of OPENAI_BASELINE) expect(b.provider).toBe('openai')
    expect(new Set(OPENAI_BASELINE.map((b) => b.officialId)).size).toBe(OPENAI_BASELINE.length)
  })

  it('独立变体分立、移动别名与日期快照不另立行;text-moderation 三别名归一行', () => {
    const ids = new Set(OPENAI_BASELINE.map((b) => b.officialId))
    for (const id of ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.6-cyber', 'gpt-oss-120b', 'gpt-oss-20b', 'text-moderation']) {
      expect(ids.has(id)).toBe(true)
    }
    for (const banned of ['chat-latest', 'chatgpt-4o-latest', 'daybreak-blue-latest', 'daybreak-red-latest', 'gpt-5-chat-latest', 'gpt-5.3-chat-latest', 'chatgpt-image-latest']) {
      expect(ids.has(banned)).toBe(false)
    }
    expect([...ids].some((id) => /-\d{8}$/.test(id))).toBe(false) // 日期快照归家族行
  })

  it('多阶段动态保留:sora-2 上线+API 扩充+弃用;gpt-5.2-codex 上线+弃用+退役;降价单列', () => {
    const kindsOf = (id: string) =>
      (OPENAI_BASELINE.find((b) => b.officialId === id)!.events ?? []).map((e) => e.kind)
    expect(kindsOf('sora-2')).toEqual(['first_party_available', 'api_available', 'updated', 'deprecated'])
    expect(kindsOf('gpt-5.2-codex')).toEqual(['api_available', 'deprecated', 'retired'])
    // 上线 → ChatGPT 产品侧 → 降价(产品发布与 API 上线按事件分立,issues/03 AC2)
    expect(kindsOf('gpt-5.6-sol')).toEqual(['api_available', 'first_party_available', 'updated'])
    // gpt-oss 同日双渠道也分立:权重开放 + API 上线
    expect(kindsOf('gpt-oss-120b')).toEqual(['weights_available', 'api_available'])
  })

  it('训练参数量:gpt-oss 双型号官方披露(MoE 总/激活分记),其余未披露为 null', () => {
    expect(OPENAI_BASELINE.find((b) => b.officialId === 'gpt-oss-120b')!.trainingParams).toEqual({ total: '117B', active: '5.1B' })
    expect(OPENAI_BASELINE.find((b) => b.officialId === 'gpt-oss-20b')!.trainingParams).toEqual({ total: '21B', active: '3.6B' })
    expect(OPENAI_BASELINE.filter((b) => b.trainingParams === null)).toHaveLength(OPENAI_BASELINE.length - 2)
  })

  it('价格保留官方口径:长上下文双档价(≤/>272K)、Sora 按秒按分辨率、审核免费、已下架价为 null', () => {
    const sol = OPENAI_BASELINE.find((b) => b.officialId === 'gpt-5.6-sol')!
    expect(sol.pricing!.entries.map((e) => e.scope)).toEqual([
      '≤272K context length',
      '≤272K context length',
      '>272K context length',
      '>272K context length',
    ])
    const soraPro = OPENAI_BASELINE.find((b) => b.officialId === 'sora-2-pro')!
    expect(soraPro.pricing!.entries).toHaveLength(3) // 720p / 1024p / 1080p 每秒价
    expect(OPENAI_BASELINE.find((b) => b.officialId === 'omni-moderation')!.pricing!.entries[0]!.text).toBe('免费')
    expect(OPENAI_BASELINE.find((b) => b.officialId === 'gpt-5.2-codex')!.pricing).toBeNull() // 关停后价格页不列
  })
})

describe('模型追踪:OpenAI 档案服务(轮询/历史去重/厂家隔离,issues/03)', () => {
  it('init 入档:OpenAI 模型在库,profile 齐备(价格/限额);信源就位(前端 tab 数据源)', async () => {
    const { db } = openDb(':memory:')
    const svc = await makeService(db, makeDeps(ZHIPU_MD))
    await svc.pollOpenAI()
    const sol = await byId(svc, 'gpt-5.6-sol')
    expect(sol!.provider).toBe('openai')
    expect(sol!.pricing!.region).toBe('OpenAI API(美元)')
    expect(sol!.limits).toEqual([
      { label: '上下文窗口', text: '1,050,000', scope: null },
      { label: '最大输出', text: '128,000', scope: null },
    ])
    const a = await svc.archive()
    expect(a.models.some((m) => m.provider === 'openai')).toBe(true)
    expect(a.sources.find((s) => s.provider === 'openai')!.stale).toBe(false)
  })

  it('历史去重:基线事件占住同 (模型,日期,锚点) 的公告,changelog 不产 updated 重复(两轮幂等)', async () => {
    const { db } = openDb(':memory:')
    const svc = await makeService(db, makeDeps(ZHIPU_MD))
    await svc.pollOpenAI()
    await svc.pollOpenAI()
    const sol = await byId(svc, 'gpt-5.6-sol')
    // 2026-07-09 家族上线:仅基线 api_available;2026-08-21 降价:仅基线 updated
    expect(sol!.events.filter((e) => e.occurredOn === '2026-07-09')).toHaveLength(1)
    expect(sol!.events.filter((e) => e.occurredOn === '2026-08-21')).toHaveLength(1)
    const terra = await byId(svc, 'gpt-5.6-terra')
    expect(terra!.events.filter((e) => e.occurredOn === '2026-07-09')).toHaveLength(1)
  })

  it('自动解析捕获基线外新公告:未记录的 changelog 条目以 updated 入库,与基线事件共存', async () => {
    const { db } = openDb(':memory:')
    const md = `# Changelog\n\n## September, 2026\n\n### Sep 9\n\nUpdate · Model: gpt-5.6-sol\n\nGPT-5.6 Sol context window expanded.\n`
    const svc = await makeService(db, makeDeps({ [OPENAI_CHANGELOG_URL]: md }))
    await svc.pollOpenAI()
    const sol = await byId(svc, 'gpt-5.6-sol')
    expect(sol!.events.filter((e) => e.occurredOn === '2026-09-09')).toEqual([
      expect.objectContaining({
        kind: 'updated',
        title: 'GPT-5.6 Sol context window expanded.',
        sourceUrl: 'https://developers.openai.com/api/docs/changelog#sep-9',
      }),
    ])
  })

  it('厂家隔离:OpenAI 上游改版只标记 openai 陈旧,智谱源与两家档案均不受影响', async () => {
    const { db } = openDb(':memory:')
    const svc = await makeService(db, makeDeps(ZHIPU_MD))
    await svc.pollOpenAI()
    // 只换 OpenAI 页(200 但零结构化条目 = 上游改版口径),不经 init → 无其他后台轮询
    const drifty = new ModelTrackingService(db, makeDeps({ [OPENAI_CHANGELOG_URL]: '<html>redesigned</html>' }))
    await expect(drifty.pollOpenAI()).rejects.toThrow('疑似上游改版')
    const a = await drifty.archive()
    expect(a.sources.find((s) => s.provider === 'openai')!.stale).toBe(true)
    expect(a.sources.find((s) => s.provider === 'zhipu')!.stale).toBe(false)
    expect((await byId(drifty, 'gpt-5.6-sol'))!.events.length).toBeGreaterThan(0) // 档案保留
    expect(a.models.some((m) => m.provider === 'zhipu')).toBe(true)
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

describe('模型追踪:百炼上下架表解析(纯函数;issues/09)', () => {
  it('只取首表:表头 th 行跳过、不补零日期归一、多 ID 切分、间距 span 剥除;hydration 拷贝表不解析', () => {
    const rows = parseBailianReleases(QWEN_HTML)
    expect(rows).toHaveLength(6)
    expect(rows[0]).toMatchObject({ date: '2026-08-24', modelIds: ['vidu/vidu-image-pro_reference2image'] })
    expect(rows[2]).toEqual({
      date: '2026-08-02',
      modelIds: ['qwen3.8-max'],
      description: 'Qwen3.8-Max 是 2.4 万亿参数 MoE 旗舰模型编程与办公能力全面跃升',
    })
    expect(rows[3]!.modelIds).toEqual(['qwen3.7-flash', 'qwen3.7-flash-2026-07-15'])
    expect(parseBailianReleases('')).toEqual([])
    expect(parseBailianReleases('<html>无表格</html>')).toEqual([])
  })

  it('模型 ID 归属:精确优先、快照前缀归家族、别名与第三方托管天然不认领', () => {
    expect(resolveQwenModelId('qwen3.8-max')).toBe('qwen3.8-max')
    expect(resolveQwenModelId('qwen3.7-max-2026-06-08')).toBe('qwen3.7-max') // 快照归家族
    expect(resolveQwenModelId('qwen3-235b-a22b-instruct-2507')).toBe('qwen3-open') // 开源代级行
    expect(resolveQwenModelId('qwen-plus-2025-04-28')).toBeNull() // 无版本别名:不立行
    expect(resolveQwenModelId('qwen-plus')).toBeNull()
    expect(resolveQwenModelId('kimi-k3')).toBeNull() // 百炼托管第三方
    expect(resolveQwenModelId('ZHIPU/GLM-5.3')).toBeNull()
    expect(resolveQwenModelId('tongyi-intent-detect-v3')).toBeNull() // 通义他线品牌(C-5 边界)
  })

  it('表格行 → 事件:同格多 ID 命中同模型只产一条;第三方/别名行零事件;信源统一主发布源页', () => {
    const hits = matchQwenEvents(parseBailianReleases(QWEN_HTML))
    expect(hits).toHaveLength(3)
    expect(hits).toContainEqual({
      officialId: 'wan3.0-video-prime',
      event: {
        kind: 'updated',
        occurredOn: '2026-08-20',
        title: 'Wan3.0-Video-Prime 是万相 3.0 的高速版视频生成模型',
        sourceUrl: QWEN_RELEASES_URL,
      },
    })
    expect(hits).toContainEqual({
      officialId: 'qwen3.7-flash',
      event: {
        kind: 'updated',
        occurredOn: '2026-07-15',
        title: 'Qwen3.7-Flash 高性价比模型(主线+快照同格)',
        sourceUrl: QWEN_RELEASES_URL,
      },
    })
    expect(hits.filter((h) => h.officialId === 'qwen-plus')).toHaveLength(0)
  })
})

describe('模型追踪:通义基线形状与服务轮询(issues/09)', () => {
  it('基线形状:provider 恒 alibaba、officialId 唯一、别名四件套不立行、非退役必有渠道、种类不越枚举', () => {
    const ids = new Set(QWEN_BASELINE.map((b) => b.officialId))
    expect(ids.size).toBe(QWEN_BASELINE.length)
    expect(QWEN_BASELINE.every((b) => b.provider === 'alibaba')).toBe(true)
    for (const alias of ['qwen-plus', 'qwen-max', 'qwen-flash', 'qwen-turbo']) {
      expect(ids.has(alias), `别名 ${alias} 不得立行`).toBe(false)
    }
    const kinds = ['text', 'multimodal_understanding', 'image_generation', 'video_generation', 'audio_speech', 'embedding', 'rerank', 'moderation_classification'] as ModelKind[]
    for (const b of QWEN_BASELINE) {
      expect(kinds).toContain(b.kind)
      expect(b.matchAliases.length).toBeGreaterThan(0)
      if (b.stage !== 'retired') expect(b.availability.length, `${b.officialId} 非退役必有渠道`).toBeGreaterThan(0)
    }
  })

  it('通义一轮:表格事件入库、与基线同 (模型,日期,信源) 的上架行不补重复动态;两轮幂等', async () => {
    const { db } = openDb(':memory:')
    const svc = await makeService(db, makeDeps(QWEN_HTML))
    await svc.pollAlibaba()
    await svc.pollAlibaba() // 幂等
    const max = (await byId(svc, 'qwen3.8-max'))!
    // 基线 api_available(2026-08-02,主发布源)已在库,同键表格行不补 updated
    expect(max.events.filter((e) => e.occurredOn === '2026-08-02')).toHaveLength(1)
    const flash = (await byId(svc, 'qwen3.7-flash'))!
    expect(flash.events.filter((e) => e.kind === 'updated')).toHaveLength(1) // 新日期 2026-07-15 入库一条
    const source = (await svc.archive()).sources.find((s) => s.provider === 'alibaba')
    expect(source).toMatchObject({ stale: false })
  })

  it('上游改版(零结构化行)标陈旧、库内通义档案保留,不影响他厂', async () => {
    const { db } = openDb(':memory:')
    const failing = await makeService(db, makeDeps({ [QWEN_RELEASES_URL]: '<html>改版空表</html>', [ZHIPU_RELEASES_URL]: ZHIPU_MD }))
    await failing.pollZhipu() // 智谱显式成功就位(不靠 init 内未等待轮询的时序)
    await expect(failing.pollAlibaba()).rejects.toThrow('发布源无结构化条目')
    const archive = await failing.archive()
    expect(archive.sources.find((s) => s.provider === 'alibaba')!.stale).toBe(true)
    expect((await byId(failing, 'qwen3.8-max'))!.events.length).toBeGreaterThan(0) // 基线在库保留
    expect(archive.sources.find((s) => s.provider === 'zhipu')!.stale).toBe(false) // 厂家隔离
  })
})
