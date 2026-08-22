import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { DEFAULT_MODEL, runAgent, type AgentDeps, type Msg, type ToolCall } from './agent'
import { clearTools, register } from './registry'

afterEach(clearTools)

/** 造一个带 tool_calls 的 assistant 假响应。 */
const toolCallResp = (call: ToolCall) => ({
  choices: [{ message: { role: 'assistant', content: null, tool_calls: [call] } }],
})
/** 造一个纯文本 assistant 假响应。 */
const textResp = (content: string) => ({
  choices: [{ message: { role: 'assistant', content } }],
})
const call = (name: string, args: unknown, id = 'c1'): ToolCall => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
})

/** 假 deps:按序吐预排响应,记录每次请求体。 */
function fakeDeps(responses: unknown[]): AgentDeps & { bodies: unknown[] } {
  const bodies: unknown[] = []
  let i = 0
  return {
    bodies,
    complete: async (body) => {
      bodies.push(body)
      const resp = responses[i++]
      if (resp === undefined) throw new Error(`假响应耗尽(第 ${i} 次请求)`)
      if (resp instanceof Error) throw resp
      return resp
    },
  }
}

const userMsg: Msg = { role: 'user', content: '查北京天气' }

describe('runAgent smoke', () => {
  it('tool-call 回灌:dispatch 进注册表、role:tool 结果追加、返回最终 assistant 消息', async () => {
    let gotInput: unknown
    let gotCtx: unknown
    register({
      name: 'weather',
      description: '查天气',
      schema: z.object({ city: z.string() }),
      handler: async (input, ctx) => ((gotInput = input), (gotCtx = ctx), { temp: 30 }),
    })
    const deps = fakeDeps([toolCallResp(call('weather', { city: '北京' })), textResp('北京 30 度')])
    const final = await runAgent([userMsg], { userId: 7, tools: ['weather'], deps })
    expect(final).toEqual({ role: 'assistant', content: '北京 30 度' })
    expect(gotInput).toEqual({ city: '北京' }) // schema parse 后的输入
    expect(gotCtx).toEqual({ userId: 7 }) // ctx 带调用方 userId
    // 第二轮请求体:原消息 + assistant(tool_calls) + role:tool 回喂;tools 已序列化;默认模型
    const second = deps.bodies[1] as { model: string; messages: Msg[]; tools: unknown }
    expect(second.model).toBe(DEFAULT_MODEL)
    expect(second.messages).toEqual([
      userMsg,
      { role: 'assistant', content: null, tool_calls: [call('weather', { city: '北京' })] },
      { role: 'tool', tool_call_id: 'c1', content: '{"temp":30}' },
    ])
    expect(second.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'weather',
          description: '查天气',
          parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'], additionalProperties: false },
        },
      },
    ])
    // 不传 tools 时请求体不带 tools 键(纯对话)
    const bare = fakeDeps([textResp('ok')])
    await runAgent([userMsg], { userId: 1, deps: bare })
    expect((bare.bodies[0] as { tools?: unknown }).tools).toBeUndefined()
  })

  it('步数打满:恒要 tool 则 8 步后报错上抛,不返回半成品', async () => {
    register({ name: 'loop', description: '', schema: z.object({}), handler: async () => 1 })
    const deps = fakeDeps(Array.from({ length: 99 }, (_, i) => toolCallResp(call('loop', {}, `c${i}`))))
    await expect(runAgent([userMsg], { userId: 1, tools: ['loop'], deps })).rejects.toThrow('步数打满 8')
    expect(deps.bodies).toHaveLength(8) // 恰好 MAX_STEPS 次 LLM 调用
  })

  it('同 tool 连续失败 2 次即中止:首次失败错误回喂一轮,第二次上抛', async () => {
    let failures = 0
    register({
      name: 'boom',
      description: '',
      schema: z.object({}),
      handler: async () => {
        throw new Error(`炸了 ${++failures}`)
      },
    })
    const deps = fakeDeps([toolCallResp(call('boom', {})), toolCallResp(call('boom', {}, 'c2'))])
    await expect(runAgent([userMsg], { userId: 1, tools: ['boom'], deps })).rejects.toThrow(
      'tool boom 连续失败 2 次中止:炸了 2',
    )
    // 首次失败确实走了回喂路径(第二轮请求里有 role:tool 错误文本)
    const second = deps.bodies[1] as { messages: Msg[] }
    expect(second.messages.at(-1)).toEqual({ role: 'tool', tool_call_id: 'c1', content: '错误:炸了 1' })
  })

  it('连续失败计数成功即清零:失败→成功→失败→成功 不中止', async () => {
    let n = 0
    register({
      name: 'flaky',
      description: '',
      schema: z.object({}),
      handler: async () => {
        if (++n % 2 === 1) throw new Error(`第 ${n} 次炸`)
        return n
      },
    })
    const responses = [
      toolCallResp(call('flaky', {}, 'c1')), // 失败1
      toolCallResp(call('flaky', {}, 'c2')), // 成功
      toolCallResp(call('flaky', {}, 'c3')), // 失败1(计数已清零)
      toolCallResp(call('flaky', {}, 'c4')), // 成功
      textResp('done'),
    ]
    const final = await runAgent([userMsg], { userId: 1, tools: ['flaky'], deps: fakeDeps(responses) })
    expect(final).toEqual({ role: 'assistant', content: 'done' })
  })

  it('入参不合 schema 走失败路径(回喂 zod 错误文本)', async () => {
    register({ name: 'strict', description: '', schema: z.object({ a: z.number() }), handler: async () => 1 })
    const deps = fakeDeps([toolCallResp(call('strict', { a: '不是数字' })), textResp('改好了')])
    const final = await runAgent([userMsg], { userId: 1, tools: ['strict'], deps })
    expect(final).toEqual({ role: 'assistant', content: '改好了' })
    const second = deps.bodies[1] as { messages: Msg[] }
    expect((second.messages.at(-1) as { content: string }).content).toContain('错误:')
  })
})
