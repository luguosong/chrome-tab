import { describe, expect, it } from 'vitest'
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
 * 模型追踪最小自动检查(issues/01 清单:单例/占格、档案持久化、基本去重、陈旧降级
 * + 路由鉴权)。IO 全经 ModelTrackingDeps 注入假实现,零真网(videoUpdates 红线)。
 */

/** 发布页快照节选(2026-08-25 实抓口径:label 不补零、相对/绝对链接混用)。 */
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
    expect(updates).toHaveLength(3)
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

  it('基线双条件匹配:GLM-5.3 块产事件;基线外型号(GLM-5.2)与非模型块跳过', () => {
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
    expect(matchZhipuEvent(updates[1]!)).toBeNull()
    expect(matchZhipuEvent(updates[2]!)).toBeNull()
  })

  it('防上游张冠李戴:描述不含基线 alias 时,即便链接 slug 相同也不归属', () => {
    // 实测坑:GLM-Image 块误链 glm-4.7 文档页——描述与链接双条件缺一不可
    const [u] = parseZhipuReleases(
      '<Update label="2026-01-14" description="GLM-Image 图像生成模型上线">\n[**GLM-Image**](/cn/guide/models/text/glm-4.7)\n</Update>',
    )
    expect(matchZhipuEvent(u!)).toBeNull()
  })
})

describe('模型追踪:档案服务(持久化/去重/陈旧)', () => {
  it('init 基线入档:profile 齐全、智谱源就位;首轮取数后 GLM-5.3 带事件', async () => {
    const { db } = openDb(':memory:')
    const svc = await makeService(db, makeDeps(ZHIPU_MD))
    await svc.pollZhipu()
    const a = await svc.archive()
    expect(a.models).toHaveLength(1)
    const m = a.models[0]!
    expect(m.name).toBe('GLM-5.3')
    expect(m.kind).toBe('text')
    expect(m.stage).toBe('ga')
    expect(m.availability).toEqual(['api', 'open_weights'])
    expect(m.sources.map((s) => s.url)).toContain('https://z.ai/blog/glm-5.3')
    expect(m.events).toHaveLength(1)
    expect(m.events[0]!.occurredOn).toBe('2026-08-19')
    expect(a.sources).toEqual([{ provider: 'zhipu', stale: false, lastSuccessAt: expect.any(String) }])
  })

  it('服务重启(同库新实例)档案仍在——持久化而非内存态', async () => {
    const { db } = openDb(':memory:')
    const svc = await makeService(db, makeDeps(ZHIPU_MD))
    await svc.pollZhipu()
    // 模拟重启:新 Service 挂同一 db,不再 init/poll,直接读
    const revived = new ModelTrackingService(db, makeDeps(''))
    const a = await revived.archive()
    expect(a.models).toHaveLength(1)
    expect(a.models[0]!.events).toHaveLength(1)
  })

  it('重复取数去重:同发布页两轮入库,事件不翻倍', async () => {
    const { db } = openDb(':memory:')
    const svc = await makeService(db, makeDeps(ZHIPU_MD))
    await svc.pollZhipu()
    await svc.pollZhipu()
    const a = await svc.archive()
    expect(a.models[0]!.events).toHaveLength(1)
  })

  it('信源失败降级:保留最后成功结果并标记陈旧,恢复后陈旧清除', async () => {
    const { db } = openDb(':memory:')
    const svc = await makeService(db, makeDeps(ZHIPU_MD))
    await svc.pollZhipu()
    const failing = new ModelTrackingService(db, failingDeps())
    await expect(failing.pollZhipu()).rejects.toThrow('HTTP 503')
    let a = await failing.archive()
    expect(a.sources[0]).toMatchObject({ provider: 'zhipu', stale: true })
    expect(a.models[0]!.events).toHaveLength(1) // 档案保留
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
    expect(a.models[0]!.events).toHaveLength(1)
  })

  it('基线幂等:init 两轮不重复建档(profile 刷新语义)', async () => {
    const { db } = openDb(':memory:')
    await makeService(db, makeDeps(''))
    await makeService(db, makeDeps(''))
    const svc = new ModelTrackingService(db, makeDeps(''))
    expect((await svc.archive()).models).toHaveLength(1)
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
    expect(json.models).toHaveLength(1)
    expect(json.sources).toHaveLength(1)
  })
})

describe('模型追踪:基线自身', () => {
  it('基线模型 supplier 一致为智谱(provider+officialId 唯一键的地基)', () => {
    for (const b of ZHIPU_BASELINE) expect(b.provider).toBe('zhipu')
    expect(new Set(ZHIPU_BASELINE.map((b) => b.officialId)).size).toBe(ZHIPU_BASELINE.length)
  })
})
