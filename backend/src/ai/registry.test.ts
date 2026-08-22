import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { clearTools, lookup, register, toGatewayTools, type ToolCtx } from './registry'

afterEach(clearTools)

/** 注册一个最小 tool(handler 记录调用,供 ctx 断言)。 */
function registerEcho() {
  const calls: { input: unknown; ctx: ToolCtx }[] = []
  register({
    name: 'echo',
    description: '回显输入',
    schema: z.object({ text: z.string() }),
    handler: async (input, ctx) => {
      calls.push({ input, ctx })
      return { echoed: input.text }
    },
  })
  return calls
}

describe('tool 注册表', () => {
  it('注册后可按名查找,handler 收到 parse 后输入与 userId 上下文', async () => {
    const calls = registerEcho()
    const tool = lookup('echo')!
    const out = await tool.handler({ text: 'hi' }, { userId: 7 })
    expect(out).toEqual({ echoed: 'hi' })
    expect(calls).toEqual([{ input: { text: 'hi' }, ctx: { userId: 7 } }])
  })

  it('未注册名查找返回 undefined;重名注册抛错', () => {
    expect(lookup('nope')).toBeUndefined()
    registerEcho()
    expect(() => registerEcho()).toThrow('重名注册')
  })

  it('schema 序列化成 OpenAI 网关 tools 参数:剥 $schema、required 正确、按名取子集', () => {
    registerEcho()
    register({ name: 'other', description: '', schema: z.object({}), handler: async () => null })
    const [echo] = toGatewayTools(['echo'])
    expect(echo).toEqual({
      type: 'function',
      function: {
        name: 'echo',
        description: '回显输入',
        parameters: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
          additionalProperties: false,
        },
      },
    })
    expect(toGatewayTools()).toHaveLength(2) // 缺省全表
  })

  it('子集里出现未注册名当场抛错', () => {
    registerEcho()
    expect(() => toGatewayTools(['echo', 'ghost'])).toThrow('未注册 tool:ghost')
  })
})
