import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CandidateExhausted, callModel, modelCandidates, runCandidateChain } from './llm'

/** 网关机制测试(ADR-0061 归属):请求形状 / 畸形载荷降级 / 候选链三态与相位 / 闸门串行;
 * 译制协议、分段与存储在 translate.test.ts,核验状态映射在 modelVerify.test.ts。 */
describe('LLM Gateway', () => {
  const realFetch = globalThis.fetch

  beforeEach(() => {
    process.env.LLM_MIN_REQUEST_INTERVAL_MS = '1'
  })

  afterEach(() => {
    globalThis.fetch = realFetch
    delete process.env.LLM_MIN_REQUEST_INTERVAL_MS
    vi.restoreAllMocks()
  })

  it('callModel 发共享补全请求(POST + system/user 消息对)并取回 content', async () => {
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(init?.method).toBe('POST')
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: 'm1',
        messages: [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'user' },
        ],
      })
      return new Response(JSON.stringify({ choices: [{ message: { content: 'answer' } }] }), {
        status: 200,
      })
    }) as typeof fetch

    await expect(callModel('m1', 'key', 'sys', 'user')).resolves.toEqual({
      content: 'answer',
      resp: JSON.stringify({ choices: [{ message: { content: 'answer' } }] }),
    })
  })

  it('callModel 畸形补全载荷统一降级 null content(不抛)', async () => {
    // 全形态对齐搬迁前 translate.test.ts 的 extractContent 直测(choices 缺失/非数组/
    // 空数组、content 非串、message null、整体 null);extractContent 现私有,经 callModel
    // 公共面覆盖
    for (const body of [
      JSON.stringify({ choices: [{ message: { content: 42 } }] }), // content 非字符串
      'null', // JSON.parse 得 null(原直测的 null 入参形态)
      '{}', // choices 缺失
      JSON.stringify({ choices: 'nope' }), // choices 非数组
      JSON.stringify({ choices: [] }), // 空数组
      JSON.stringify({ choices: [{ message: null }] }), // message null
    ]) {
      globalThis.fetch = vi.fn(async () => new Response(body, { status: 200 })) as typeof fetch
      await expect(callModel('m1', 'key', 'sys', 'user')).resolves.toMatchObject({ content: null })
    }
  })

  it('候选链遇软失效哨兵换下一候选', async () => {
    const seen: string[] = []
    await expect(
      runCandidateChain(['m1', 'm2'], async (model) => {
        seen.push(model)
        if (model === 'm1') throw new CandidateExhausted('unusable')
        return 'answer'
      }),
    ).resolves.toEqual({ status: 'answer', value: 'answer' })
    expect(seen).toEqual(['m1', 'm2'])
  })

  it('modelCandidates free 优先默认链 + env 覆盖 trim / 纯分隔符回退', () => {
    expect(modelCandidates()).toEqual([
      'coding-glm-5.3-flash-free',
      'coding-glm-5.3-free',
      'coding-kimi-k3-free',
      'gemini-3.7-flash-free',
      'gpt-5.5-free',
      'coding-glm-5-free',
      'coding-glm-5.3',
    ])
    expect(modelCandidates({ CHANGELOG_LLM_MODEL: ' a , b,,' } as NodeJS.ProcessEnv)).toEqual(['a', 'b'])
    expect(modelCandidates({ CHANGELOG_LLM_MODEL: ',,,' } as NodeJS.ProcessEnv)).toEqual(modelCandidates())
  })

  it('候选链终局:exhausted 聚合末次错误 / fatal 停链带候选上下文', async () => {
    const exhausted = await runCandidateChain(['m1', 'm2'], async (model) => {
      if (model === 'm1') throw new CandidateExhausted('soft')
      const error = Object.assign(new Error('rate limited'), { status: 429 })
      throw error
    })
    expect(exhausted).toMatchObject({ status: 'exhausted', lastErr: { message: 'rate limited' } })

    const fatalError = new Error('bad key')
    await expect(
      runCandidateChain(['m1', 'm2'], async (model) => {
        if (model === 'm1') throw new CandidateExhausted('soft')
        throw fatalError
      }),
    ).resolves.toEqual({ status: 'fatal', err: fatalError, model: 'm2', index: 2 })
  })

  it('候选链空链 lastErr 为 null + onAttempt 相位上报(1 基序数)', async () => {
    await expect(runCandidateChain([], async () => 'unused')).resolves.toEqual({
      status: 'exhausted',
      lastErr: null,
    })

    const phases: Array<[string, number, number]> = []
    const attempts: Array<[string, number, number]> = []
    await expect(
      runCandidateChain(
        ['m1', 'm2'],
        async (model, index, total) => {
          attempts.push([model, index, total])
          if (model === 'm1') throw new CandidateExhausted('soft')
          return 'ok'
        },
        (model, index, total) => phases.push([model, index, total]),
      ),
    ).resolves.toEqual({ status: 'answer', value: 'ok' })
    expect(phases).toEqual([
      ['m1', 1, 2],
      ['m2', 2, 2],
    ])
    expect(attempts).toEqual(phases)
  })

  it('闸门串行化:连续请求间隔 ≥ 阈值', async () => {
    process.env.LLM_MIN_REQUEST_INTERVAL_MS = '80'
    const times: number[] = []
    globalThis.fetch = vi.fn(async () => {
      times.push(Date.now())
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 })
    }) as typeof fetch

    await callModel('m1', 'key', 'sys', 'user')
    await callModel('m2', 'key', 'sys', 'user')
    expect(times).toHaveLength(2)
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(50)
  })
})
