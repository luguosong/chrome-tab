import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildNumberedList,
  extractContent,
  makeBatchTranslator,
  modelCandidates,
  parseNumberedTranslations,
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
  it('默认:六 free + coding-glm-5.3 兜底', () => {
    expect(modelCandidates()).toEqual([
      'coding-glm-5.1-free',
      'coding-kimi-k3-free',
      'gemini-3.6-flash-free',
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
  afterEach(() => {
    globalThis.fetch = realFetch
    delete process.env.AIHUBMIX_API_KEY
    delete process.env.CHANGELOG_LLM_MODEL
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
})
