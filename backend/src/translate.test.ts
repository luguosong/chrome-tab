import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDb } from './db'
import {
  buildNumberedList,
  extractContent,
  makeBatchTranslator,
  makeBlockTranslator,
  makeTranslationStore,
  modelCandidates,
  parseNumberedTranslations,
  sha256,
  splitSegments,
} from './translate'

/** 机制层测试(ADR-0029 首建编号协议;ADR-0032 起含网关地基与候选链真链路):
 * 纯函数(编号配对、漏行/畸行 null、围栏宽容、响应解析、候选链 env 解析)直测;
 * 候选链走 mock globalThis.fetch 真链路(同 changelog.test.ts mockFetchSeq 先例)。 */
describe('parseNumberedTranslations', () => {
  it('正常逐条配对', () => {
    expect(parseNumberedTranslations('1. 甲\n2. 乙\n3. 丙', 3)).toEqual(['甲', '乙', '丙'])
  })

  it('漏行该条 null(下轮重试)', () => {
    expect(parseNumberedTranslations('1. 甲\n3. 丙', 3)).toEqual(['甲', null, '丙'])
  })

  it('乱序行按序号归位', () => {
    expect(parseNumberedTranslations('2. 乙\n1. 甲', 2)).toEqual(['甲', '乙'])
  })

  it('剥代码围栏与空行', () => {
    const out = parseNumberedTranslations('```\n\n1. 甲\n\n2. 乙\n```', 2)
    expect(out).toEqual(['甲', '乙'])
  })

  it('带语言标注的围栏行也剥', () => {
    expect(parseNumberedTranslations('```text\n1. 甲\n```', 1)).toEqual(['甲'])
  })

  it('超范围序号忽略;全畸零配对', () => {
    expect(parseNumberedTranslations('0. 零\n1. 甲\n9. 九', 2)).toEqual(['甲', null])
    expect(parseNumberedTranslations('抱歉我无法翻译', 2)).toEqual([null, null])
  })

  it('中文序号分隔符与全角冒号宽容', () => {
    expect(parseNumberedTranslations('1、甲\n2:乙\n3:丙', 3)).toEqual(['甲', '乙', '丙'])
  })

  it('count 为 0 恒空数组', () => {
    expect(parseNumberedTranslations('1. 甲', 0)).toEqual([])
  })

  it('构造↔解析对偶:忠实回显序号的批全额配对(回归:全局连续编号第二批恒空)', () => {
    // 任意一批(含 >20 条切批后的第二批形态):模型按输入序号回显译文
    const batches = [
      Array.from({ length: 20 }, (_, i) => `title-${i}`), // 第一批满批
      Array.from({ length: 7 }, (_, i) => `title-${20 + i}`), // 第二批残余
    ]
    for (const batch of batches) {
      const echoed = buildNumberedList(batch.map((t) => `译(${t})`))
      expect(parseNumberedTranslations(echoed, batch.length).every((t) => t != null)).toBe(true)
    }
  })
})

// ---- 网关地基(ADR-0032 自 changelog.ts 随符号迁入)----

describe('extractContent(畸形响应 → null 触发降级,不抛)', () => {
  it('取 choices[0].message.content', () => {
    expect(extractContent({ choices: [{ message: { content: '译文' } }] })).toBe('译文')
  })

  it('choices 缺失 / 非数组 / 空数组 → null', () => {
    expect(extractContent(null)).toBeNull()
    expect(extractContent({})).toBeNull()
    expect(extractContent({ choices: 'nope' })).toBeNull()
    expect(extractContent({ choices: [] })).toBeNull()
  })

  it('content 非字符串 → null', () => {
    expect(extractContent({ choices: [{ message: { content: 42 } }] })).toBeNull()
    expect(extractContent({ choices: [{ message: null }] })).toBeNull()
  })
})

describe('modelCandidates(free 优先,CHANGELOG_LLM_MODEL 逗号分隔覆盖)', () => {
  it('默认:coding-glm-5.3-flash-free 打头,其余 free + coding-glm-5.3 兜底', () => {
    expect(modelCandidates()).toEqual([
      'coding-glm-5.3-flash-free',
      'coding-glm-5.3-free',
      'coding-kimi-k3-free',
      'gemini-3.7-flash-free',
      'gpt-5.5-free',
      'coding-glm-5-free',
      'coding-glm-5.3',
    ])
  })

  it('env 覆盖:逗号分隔 + trim,空段过滤;空串回默认(compose 缺省键注入的是 "")', () => {
    expect(modelCandidates({ CHANGELOG_LLM_MODEL: ' a , b,,' } as NodeJS.ProcessEnv)).toEqual(['a', 'b'])
    expect(modelCandidates({ CHANGELOG_LLM_MODEL: '' } as NodeJS.ProcessEnv)).toEqual(modelCandidates())
  })

  it('纯分隔符(如 ",")过滤后为空 → 回默认:候选链恒空会让调用方 throw undefined', () => {
    expect(modelCandidates({ CHANGELOG_LLM_MODEL: ',,,' } as NodeJS.ProcessEnv)).toEqual(modelCandidates())
  })
})

describe('makeBatchTranslator 候选链(真链路 mock fetch;no_key/换候选/401 fatal/部分成果)', () => {
  const realFetch = globalThis.fetch
  // 节流闸门默认 12s(free 5rpm),测试注入 1ms 跳过等待;节流行为本身单测见末尾用例
  beforeEach(() => {
    process.env.LLM_MIN_REQUEST_INTERVAL_MS = '1'
  })
  afterEach(() => {
    globalThis.fetch = realFetch
    delete process.env.AIHUBMIX_API_KEY
    delete process.env.CHANGELOG_LLM_MODEL
    delete process.env.LLM_MIN_REQUEST_INTERVAL_MS
    vi.restoreAllMocks()
  })

  /** 同 changelog.test.ts mockFetchSeq:依次返回 seq 响应,记录请求的 model 顺序。 */
  function mockFetchSeq(seq: Array<{ status?: number; body?: unknown }>): string[] {
    const models: string[] = []
    let i = 0
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      models.push(JSON.parse(String(init?.body)).model)
      const s = seq[Math.min(i++, seq.length - 1)]!
      return new Response(JSON.stringify(s.body), { status: s.status ?? 200 })
    }) as typeof fetch
    return models
  }

  const OK = (content: string) => ({ status: 200, body: { choices: [{ message: { content } }] } })
  const NO_CHANNEL = { status: 400, body: { error: { code: 'no_available_channel' } } }

  it('无 Key:有声拒绝,恒返全 null 不发请求', async () => {
    delete process.env.AIHUBMIX_API_KEY // 显式清环境(dev 机可能导出了 Key)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const t = makeBatchTranslator('sys', 'tag-test')
    await expect(t(['a', 'b'])).resolves.toEqual([null, null])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('未配置 AIHUBMIX_API_KEY'))
  })

  it('候选失效换下一个直到成功;配对译文按批内序号入位', async () => {
    process.env.AIHUBMIX_API_KEY = 'k'
    process.env.CHANGELOG_LLM_MODEL = 'm1,m2'
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const models = mockFetchSeq([NO_CHANNEL, OK('1. 甲\n2. 乙')])
    await expect(makeBatchTranslator('sys', 'tag-test')(['a', 'b'])).resolves.toEqual(['甲', '乙'])
    expect(models).toEqual(['m1', 'm2'])
  })

  it('401(key 无效)不可换路:终止后续批,已完成批次的部分成果照常返回', async () => {
    process.env.AIHUBMIX_API_KEY = 'k'
    process.env.CHANGELOG_LLM_MODEL = 'm1'
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    // 25 条 = 2 批(20+5):批 1 全额配对成功,批 2 首请求 401 → fatal 终止,批 2 条目 null
    const texts = Array.from({ length: 25 }, (_, i) => `t${i}`)
    const batch1Ok = {
      status: 200,
      body: { choices: [{ message: { content: Array.from({ length: 20 }, (_, i) => `${i + 1}. 一`).join('\n') } }] },
    }
    const models = mockFetchSeq([batch1Ok, { status: 401, body: {} }])
    const out = await makeBatchTranslator('sys', 'tag-test')(texts)
    expect(models).toEqual(['m1', 'm1'])
    expect(out.slice(0, 20)).toEqual(Array.from({ length: 20 }, () => '一'))
    expect(out.slice(20)).toEqual([null, null, null, null, null])
  })

  it('节流闸门:连续两次网关请求至少间隔 LLM_MIN_REQUEST_INTERVAL_MS(free 5rpm 限额;闸门住 callModel,ADR-0037)', async () => {
    process.env.AIHUBMIX_API_KEY = 'k'
    process.env.LLM_MIN_REQUEST_INTERVAL_MS = '80' // 覆盖 beforeEach 的 1ms(闸门读 process.env,非构造参数)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const times: number[] = []
    globalThis.fetch = vi.fn(async () => {
      times.push(Date.now())
      return new Response(JSON.stringify(OK('1. 甲').body), { status: 200 })
    }) as typeof fetch
    const t = makeBatchTranslator('sys', 'tag-gate')
    await t(['a'])
    await t(['b'])
    expect(times.length).toBe(2)
    // 闸门间隔按「放行时刻」计,fetch 时刻差带 ±几 ms 微任务噪声(80 全额偶发 79);50 居中判别
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(50)
  })
})

// ---- 单块分段译制(ADR-0053 自 changelog 归位;用例随迁,被测对象从 prodChangelogDeps.translate
// ---- 改为 maker 直测——候选链机制与分段语义都是本文件的 interface)----

describe('splitSegments(段=行边界,单请求输出压小,稳离 60s 超时)', () => {
  it('不超过上限整块一段,原样返回', () => {
    expect(splitSegments('## 1.0\n- x\n')).toEqual(['## 1.0\n- x\n'])
  })

  it('超上限按行切段:每段 ≤上限、行不撕开、标题行留首段', () => {
    const line = `- ${'a'.repeat(98)}\n` // 101 字符/行
    const block = `## 9.9\n${line.repeat(20)}` // 7 + 2020 = 2027 > 2000
    const segs = splitSegments(block)
    expect(segs.length).toBe(2)
    expect(segs[0]).toBe(`## 9.9\n${line.repeat(19)}`)
    expect(segs[1]).toBe(line)
    expect(segs.every((s) => s.length <= 2000)).toBe(true)
  })

  it('单行自身超上限:独占一段不撕行(前段先按上限封住)', () => {
    const huge = `- ${'a'.repeat(3000)}\n`
    expect(splitSegments(`## 1.0\n${huge}- small\n`)).toEqual(['## 1.0\n', huge, '- small\n'])
  })
})

describe('makeBlockTranslator 候选链(候选失效=403/404/429/5xx/no_available_channel/超时/200空content 换下一个,401等直接抛)', () => {
  const realFetch = globalThis.fetch
  // 闸门住 callModel(ADR-0037):真链路用例过闸,注入 1ms 跳过等待;节流行为本身单测见末尾用例
  beforeEach(() => {
    process.env.LLM_MIN_REQUEST_INTERVAL_MS = '1'
  })
  afterEach(() => {
    globalThis.fetch = realFetch
    delete process.env.AIHUBMIX_API_KEY
    delete process.env.CHANGELOG_LLM_MODEL
    delete process.env.LLM_MIN_REQUEST_INTERVAL_MS
  })

  /** 依次返回 seq 响应(超出取末个),记录每次请求的 model 字段顺序;timeout: true 模拟超时拒绝。 */
  function mockFetchSeq(seq: Array<{ status?: number; body?: unknown; timeout?: boolean }>): string[] {
    const models: string[] = []
    let i = 0
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      models.push(JSON.parse(String(init?.body)).model)
      const s = seq[Math.min(i++, seq.length - 1)]!
      if (s.timeout) throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
      return new Response(JSON.stringify(s.body), { status: s.status ?? 200 })
    }) as typeof fetch
    return models
  }

  const OK = { status: 200, body: { choices: [{ message: { content: '译文' } }] } }
  const NO_CHANNEL = { status: 400, body: { error: { code: 'no_available_channel' } } }
  const make = () => makeBlockTranslator('sys', 'block-translate-test')

  it('no_available_channel → 换下一候选直到成功,请求按候选序', async () => {
    process.env.AIHUBMIX_API_KEY = 'k'
    process.env.CHANGELOG_LLM_MODEL = 'm1,m2,m3'
    const models = mockFetchSeq([NO_CHANNEL, NO_CHANNEL, OK])
    await expect(make()('块')).resolves.toBe('译文')
    expect(models).toEqual(['m1', 'm2', 'm3'])
  })

  it('403(模型被禁,如线上 coding-kimi-k3-free)同样换下一候选', async () => {
    process.env.AIHUBMIX_API_KEY = 'k'
    process.env.CHANGELOG_LLM_MODEL = 'm1,m2'
    const models = mockFetchSeq([{ status: 403, body: {} }, OK])
    await expect(make()('块')).resolves.toBe('译文')
    expect(models).toEqual(['m1', 'm2'])
  })

  it('超时(TimeoutError)同样换下一候选:挂死模型不再拖满单模型上限(300s→60s 语义配套)', async () => {
    process.env.AIHUBMIX_API_KEY = 'k'
    process.env.CHANGELOG_LLM_MODEL = 'm1,m2'
    const models = mockFetchSeq([{ timeout: true }, OK])
    await expect(make()('块')).resolves.toBe('译文')
    expect(models).toEqual(['m1', 'm2'])
  })

  it('200 但响应无 content(free 模型空补全/畸形)→ 换下一候选,不整体静默失败', async () => {
    process.env.AIHUBMIX_API_KEY = 'k'
    process.env.CHANGELOG_LLM_MODEL = 'm1,m2'
    const models = mockFetchSeq([{ status: 200, body: { choices: [{ message: { content: null } }] } }, OK])
    await expect(make()('块')).resolves.toBe('译文')
    expect(models).toEqual(['m1', 'm2'])
  })

  it('200 但 content 为空串 → 同判候选失效:空译文入哈希表会让该版本永久渲染空行', async () => {
    process.env.AIHUBMIX_API_KEY = 'k'
    process.env.CHANGELOG_LLM_MODEL = 'm1,m2'
    const models = mockFetchSeq([{ status: 200, body: { choices: [{ message: { content: '' } }] } }, OK])
    await expect(make()('块')).resolves.toBe('译文')
    expect(models).toEqual(['m1', 'm2'])
  })

  it('5xx(网关/上游错误)→ 换下一候选', async () => {
    process.env.AIHUBMIX_API_KEY = 'k'
    process.env.CHANGELOG_LLM_MODEL = 'm1,m2'
    const models = mockFetchSeq([{ status: 502, body: 'bad gateway' }, OK])
    await expect(make()('块')).resolves.toBe('译文')
    expect(models).toEqual(['m1', 'm2'])
  })

  it('401(key 无效)换模型无益:直接抛,不再请求', async () => {
    process.env.AIHUBMIX_API_KEY = 'k'
    process.env.CHANGELOG_LLM_MODEL = 'm1,m2'
    const models = mockFetchSeq([{ status: 401, body: { error: { code: 'invalid_api_key' } } }])
    await expect(make()('块')).rejects.toThrow('HTTP 401')
    expect(models).toEqual(['m1'])
  })

  it('全链候选失效:抛末次错误(调用方 warn 降级英文)', async () => {
    process.env.AIHUBMIX_API_KEY = 'k'
    process.env.CHANGELOG_LLM_MODEL = 'm1,m2'
    const models = mockFetchSeq([NO_CHANNEL, NO_CHANNEL])
    await expect(make()('块')).rejects.toThrow('HTTP 400')
    expect(models).toEqual(['m1', 'm2'])
  })

  it('Key 缺失:返回 null(调用方据此透传英文原文)', async () => {
    await expect(make()('块')).resolves.toBeNull()
  })

  it('onPhase 回调:每次换候选前上报 (model, attempt, total),调用方据此暴露阶段', async () => {
    process.env.AIHUBMIX_API_KEY = 'k'
    process.env.CHANGELOG_LLM_MODEL = 'm1,m2'
    const events: Array<[string, number, number]> = []
    mockFetchSeq([NO_CHANNEL, OK])
    await make()('块', (model, attempt, total) => events.push([model, attempt, total]))
    expect(events).toEqual([
      ['m1', 1, 2],
      ['m2', 2, 2],
    ])
  })

  it('节流闸门:换候选的连续两次请求至少间隔 LLM_MIN_REQUEST_INTERVAL_MS(闸门住 callModel,三域共享)', async () => {
    process.env.AIHUBMIX_API_KEY = 'k'
    process.env.CHANGELOG_LLM_MODEL = 'm1,m2'
    process.env.LLM_MIN_REQUEST_INTERVAL_MS = '80'
    const times: number[] = []
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      times.push(Date.now())
      const model = JSON.parse(String(init?.body)).model
      if (model === 'm1') return new Response(JSON.stringify(NO_CHANNEL.body), { status: NO_CHANNEL.status })
      return new Response(JSON.stringify(OK.body), { status: 200 })
    }) as typeof fetch
    await expect(make()('块')).resolves.toBe('译文')
    expect(times.length).toBe(2)
    // 闸门间隔按「放行时刻」计,fetch 时刻差带 ±几 ms 微任务噪声,80 全额会偶发 79——
    // 无闸裸奔实测 0~3ms,50 居中判别(闸门用例同款)
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(50)
  })
})

describe('makeBlockTranslator 分段(大块逐段请求,段失败换候选只重试该段)', () => {
  const realFetch = globalThis.fetch
  // 闸门住 callModel(ADR-0037):分段真链路多次过闸,注入 1ms 跳过等待
  beforeEach(() => {
    process.env.LLM_MIN_REQUEST_INTERVAL_MS = '1'
  })
  afterEach(() => {
    globalThis.fetch = realFetch
    delete process.env.AIHUBMIX_API_KEY
    delete process.env.CHANGELOG_LLM_MODEL
    delete process.env.LLM_MIN_REQUEST_INTERVAL_MS
  })

  /** mockFetchSeq 的分段版:另记录每次请求的 user content(断言段大小与内容)。 */
  function mockFetchSeqLog(seq: Array<{ status?: number; body?: unknown; timeout?: boolean }>): {
    models: string[]
    users: string[]
  } {
    const models: string[] = []
    const users: string[] = []
    let i = 0
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      models.push(body.model)
      users.push(body.messages[1].content)
      const s = seq[Math.min(i++, seq.length - 1)]!
      if (s.timeout) throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
      return new Response(JSON.stringify(s.body), { status: s.status ?? 200 })
    }) as typeof fetch
    return { models, users }
  }

  const NO_CHANNEL = { status: 400, body: { error: { code: 'no_available_channel' } } }
  const line = (tag: string) => `- ${'a'.repeat(96)} ${tag}\n` // 102 字符/行
  const ok = (content: string) => ({ status: 200, body: { choices: [{ message: { content } }] } })
  const make = () => makeBlockTranslator('sys', 'block-translate-test')

  /** 21 行 × 102 字符 + 标题 = 2149 > 2000 → 恰切 2 段;段内容断言委托 splitSegments 自身。 */
  const bigBlock = `## 9.9\n${Array.from({ length: 21 }, (_, i) => line(`s${i}`)).join('')}`
  const segs = splitSegments(bigBlock)

  it('大块 → 多次请求,每次 user = splitSegments 的段,译文按段序拼接(段间补换行防粘行)', async () => {
    process.env.AIHUBMIX_API_KEY = 'k'
    process.env.CHANGELOG_LLM_MODEL = 'm1'
    const { models, users } = mockFetchSeqLog([ok('段一译文'), ok('段二译文')])
    await expect(make()(bigBlock)).resolves.toBe('段一译文\n段二译文')
    expect(models).toEqual(['m1', 'm1'])
    expect(users).toEqual(segs)
  })

  it('段 2 首候选 no_available_channel → 换候选只重试该段,段 1 译文不重译', async () => {
    process.env.AIHUBMIX_API_KEY = 'k'
    process.env.CHANGELOG_LLM_MODEL = 'm1,m2'
    const { models } = mockFetchSeqLog([ok('段一'), NO_CHANNEL, ok('段二')])
    await expect(make()(bigBlock)).resolves.toBe('段一\n段二')
    expect(models).toEqual(['m1', 'm1', 'm2'])
  })

  it('某段全链候选失效 → 整块 reject(调用方 warn 降级英文,语义同前)', async () => {
    process.env.AIHUBMIX_API_KEY = 'k'
    process.env.CHANGELOG_LLM_MODEL = 'm1,m2'
    const { models } = mockFetchSeqLog([ok('段一'), NO_CHANNEL, NO_CHANNEL])
    await expect(make()(bigBlock)).rejects.toThrow('HTTP 400')
    expect(models).toEqual(['m1', 'm1', 'm2'])
  })
})

// ---- 哈希译文仓(ADR-0034:三张「译文表」存储机制单点;真内存 SQLite)----

describe('makeTranslationStore load/save(原文键;哈希是 implementation)', () => {
  /** 每用例新库:译文表用 news 侧(三表同形,机制不挑表)。 */
  function freshStore() {
    const { db } = openDb(':memory:')
    return { db, store: makeTranslationStore(db, 'news_translations') }
  }

  async function seedTitle(db: ReturnType<typeof openDb>['db'], title: string, translated: string) {
    await db
      .insertInto('news_translations')
      .values({ title_hash: sha256(title), translated, created_at: new Date().toISOString() })
      .execute()
  }

  it('load:命中的原文返回译文,未命中不入 Map(调用方 ?? null 保持原文)', async () => {
    const { db, store } = freshStore()
    await seedTitle(db, 'hello world', '你好,世界')
    const zh = await store.load(['hello world', 'never stored'])
    expect(zh.get('hello world')).toBe('你好,世界')
    expect(zh.has('never stored')).toBe(false)
  })

  it('load:>500 条分批全量命中 + 入参去重(LOAD_CHUNK=500 边界)', async () => {
    const { db, store } = freshStore()
    const texts = Array.from({ length: 501 }, (_, i) => `title-${i}`)
    await db
      .insertInto('news_translations')
      .values(texts.map((t) => ({ title_hash: sha256(t), translated: `译(${t})`, created_at: new Date().toISOString() })))
      .execute()
    const zh = await store.load([...texts, ...texts.slice(0, 10)]) // 511 入参、501 唯一
    expect(zh.size).toBe(501)
    expect(zh.get('title-500')).toBe('译(title-500)')
  })

  it('save:幂等入库——同原文二次保存不覆盖已有译文(哈希即身份,终身只译一次)', async () => {
    const { store } = freshStore()
    await store.save([{ text: 'a', translated: '甲' }])
    await store.save([{ text: 'a', translated: '乙(后到不盖)' }])
    expect((await store.load(['a'])).get('a')).toBe('甲')
  })

  it('save:空串/纯空白译文丢弃——空哈希行会终身缓存成空白(2026-08-25 事故形态)', async () => {
    const { store } = freshStore()
    await store.save([
      { text: 'blank', translated: '' },
      { text: 'space', translated: '   ' },
      { text: 'ok', translated: '好' },
    ])
    const zh = await store.load(['blank', 'space', 'ok'])
    expect(zh.size).toBe(1)
    expect(zh.get('ok')).toBe('好')
  })

  it('ensure:滤掉的与已有的不送译;null 译文(本轮未译成)不写,下轮重试', async () => {
    const { db, store } = freshStore()
    await seedTitle(db, 'have', '已有')
    const received: string[][] = []
    const translate = vi.fn(async (texts: string[]) => {
      received.push(texts)
      return ['新译', null] // fresh → '新译';nullout → null 不写
    })
    await store.ensure(['have', 'fresh', 'skip-me', 'nullout'], translate, (t) => t !== 'skip-me')
    expect(received).toEqual([['fresh', 'nullout']]) // 去重、滤除、缺译有序
    const zh = await store.load(['have', 'fresh', 'nullout', 'skip-me'])
    expect(zh.get('have')).toBe('已有') // 先入为主不被触碰
    expect(zh.get('fresh')).toBe('新译')
    expect(zh.has('nullout')).toBe(false)
    expect(zh.has('skip-me')).toBe(false)
  })

  it('ensure:无缺译(全已有或全被滤)→ translator 零调用、零入库', async () => {
    const { db, store } = freshStore()
    await seedTitle(db, 'have', '已有')
    const translate = vi.fn(async (texts: string[]) => texts.map(() => '不该被调用'))
    await store.ensure(['have', '中文原文'], translate, (t) => t !== '中文原文')
    expect(translate).not.toHaveBeenCalled()
  })

  it('三张译文表分派支各字面量列名配对正确(save→load 往返,锁 ADR-0034 判别分派)', async () => {
    for (const table of ['changelog_translations', 'news_translations', 'trending_translations'] as const) {
      const { db } = openDb(':memory:')
      const store = makeTranslationStore(db, table)
      await store.save([{ text: 'same source text', translated: '同一句原文' }])
      expect((await store.load(['same source text'])).get('same source text')).toBe('同一句原文')
    }
  })
})
