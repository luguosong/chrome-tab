import { describe, expect, it } from 'vitest'
import { makeTailQueue } from './pollPersist'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** makeTailQueue 直测(ADR-0039):此前尾链只被 news/video 两域集成测试间接踩过,
 * 抽成独立 seam 后自证三条不变量——顺序、失败续传、idle 对账口径。 */
describe('makeTailQueue', () => {
  it('按提交序串行执行(后提交者不得插队)', async () => {
    const q = makeTailQueue()
    const order: number[] = []
    const submit = (n: number, ms: number) =>
      q.enqueue(async () => {
        await sleep(ms)
        order.push(n)
      })
    const p1 = submit(1, 30)
    const p2 = submit(2, 5) // 更短的任务后提交,仍须等前序完成
    const p3 = submit(3, 5)
    await Promise.all([p1, p2, p3])
    expect(order).toEqual([1, 2, 3])
  })

  it('前序失败不阻塞后来者(生产形态:pollAllQuietly fire-and-forget,不先 await 失败者)', async () => {
    const q = makeTailQueue()
    const boom = q.enqueue(async () => {
      throw new Error('x')
    })
    const after = await q.enqueue(async () => 'ok')
    expect(after).toBe('ok')
    await expect(boom).rejects.toThrow('x')
  })

  it('idle 等待当前尾链排空', async () => {
    const q = makeTailQueue()
    let done = false
    void q.enqueue(async () => {
      await sleep(20)
      done = true
    })
    await q.idle()
    expect(done).toBe(true)
  })
})
