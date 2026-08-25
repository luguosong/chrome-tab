import { describe, expect, it } from 'vitest'
import type { ModelKind } from 'chrome-tab-shared'
import { SINGLETON_TYPES, TYPE_SPANS } from './icons'
import { createApp } from './app'
import { bootstrap } from './seed'
import { openDb, type Db } from './db'
import {
  ModelTrackingService,
  ZHIPU_BASELINE,
  matchZhipuEvent,
  normalizeZhipuDate,
  parseZhipuReleases,
  type ModelTrackingDeps,
} from './modelTracking'

/**
 * 模型追踪自动检查(issues/01:单例/占格、持久化、陈旧降级 + 鉴权;issues/02:八类
 * 映射、厂家归属、历史去重、多事件保留、退役排序、详情缺省值)。IO 全经
 * ModelTrackingDeps 注入假实现,零真网(videoUpdates 红线)。
 */

/** 发布页快照节选(2026-08-25 实抓口径:label 不补零、相对/绝对链接混用;含第三方 Vidu 块)。 */
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

function makeDeps(md: string): ModelTrackingDeps {
  return { fetchText: async () => md }
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

  it('已退役模型入档且 stage=retired、排序沉底', async () => {
    const { db } = openDb(':memory:')
    const svc = await makeService(db, makeDeps(ZHIPU_MD))
    const a = await svc.archive()
    const retired = a.models.filter((m) => m.stage === 'retired')
    expect(retired.map((m) => m.officialId).sort()).toEqual(['glm-4-0520', 'glm-z1'])
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
  it('init 基线入档:全量模型、profile 字段(定价/限额/参数量)齐备;首轮取数后智谱源就位', async () => {
    const { db } = openDb(':memory:')
    const svc = await makeService(db, makeDeps(ZHIPU_MD))
    await svc.pollZhipu()
    const a = await svc.archive()
    expect(a.models).toHaveLength(ZHIPU_BASELINE.length)
    const glm53 = a.models.find((m) => m.officialId === 'glm-5.3')!
    expect(glm53.kind).toBe('text')
    expect(glm53.stage).toBe('ga')
    expect(glm53.pricing!.entries[0]).toEqual({ text: '输入 8 元/百万 tokens', scope: null })
    expect(glm53.pricing!.region).toContain('中国大陆')
    expect(glm53.limits).toEqual([
      { label: '上下文窗口', text: '1M', scope: null },
      { label: '最大输出', text: '128K', scope: null },
    ])
    expect(a.sources).toEqual([{ provider: 'zhipu', stale: false, lastSuccessAt: expect.any(String) }])
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

  it('官方披露的训练参数量原样保留(GLM-5 744B / GLM-OCR 0.9B)', async () => {
    const { db } = openDb(':memory:')
    const svc = await makeService(db, makeDeps(''))
    expect((await byId(svc, 'glm-5'))!.trainingParams).toBe('744B(激活 40B)')
    expect((await byId(svc, 'glm-ocr'))!.trainingParams).toBe('0.9B')
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
    expect(a.models).toHaveLength(ZHIPU_BASELINE.length)
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
    expect(a.sources[0]).toMatchObject({ provider: 'zhipu', stale: true })
    expect((await byId(failing, 'glm-5.3'))!.events.length).toBeGreaterThan(0) // 档案保留
    const ok = new ModelTrackingService(db, makeDeps(ZHIPU_MD))
    await ok.pollZhipu()
    a = await ok.archive()
    expect(a.sources[0]!.stale).toBe(false)
  })

  it('上游改版降级:200 但零结构化块 → 抛错并置陈旧,既有档案保留', async () => {
    const { db } = openDb(':memory:')
    const svc = await makeService(db, makeDeps(ZHIPU_MD))
    await svc.pollZhipu()
    const drifty = new ModelTrackingService(db, makeDeps('<html>上游改版了</html>'))
    await expect(drifty.pollZhipu()).rejects.toThrow('疑似上游改版')
    const a = await drifty.archive()
    expect(a.sources[0]!.stale).toBe(true)
    expect(a.models).toHaveLength(ZHIPU_BASELINE.length)
  })

  it('基线幂等:init 两轮不重复建档(profile 刷新语义)', async () => {
    const { db } = openDb(':memory:')
    await makeService(db, makeDeps(''))
    await makeService(db, makeDeps(''))
    const svc = new ModelTrackingService(db, makeDeps(''))
    expect((await svc.archive()).models).toHaveLength(ZHIPU_BASELINE.length)
  })
})

describe('模型追踪:路由', () => {
  it('GET /api/model-tracking/archive 需登录(401)且带登录态返回信封', async () => {
    const { db } = openDb(':memory:')
    await bootstrap(db, { username: 'admin', password: 'admin-pw' })
    const svc = await makeService(db, makeDeps(ZHIPU_MD))
    await svc.pollZhipu()
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
    expect(json.models).toHaveLength(ZHIPU_BASELINE.length)
    expect(json.sources).toHaveLength(1)
  })
})
