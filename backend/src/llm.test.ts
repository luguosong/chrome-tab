import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CandidateExhausted, callModel, modelCandidates, runCandidateChain } from './llm'

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

  it('callModel extracts content and sends the shared completion request', async () => {
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

  it('callModel turns malformed completion payloads into null content', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: 42 } }] }), { status: 200 }),
    ) as typeof fetch

    await expect(callModel('m1', 'key', 'sys', 'user')).resolves.toMatchObject({ content: null })
  })

  it('runCandidateChain advances after a soft exhaustion sentinel', async () => {
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

  it('modelCandidates prefers free models and accepts a trimmed env override', () => {
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

  it('runCandidateChain reports exhausted and fatal terminal states', async () => {
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

  it('runCandidateChain preserves empty-chain and attempt-phase semantics', async () => {
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

  it('callModel gate spaces consecutive requests', async () => {
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
