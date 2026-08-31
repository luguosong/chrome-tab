/**
 * script 注入通道加载器族(CONTEXT.md「自选股」;ADR-0046):
 * var 通道 loadVarScript(腾讯系:qt.gtimg/smartbox,注入后读全局 v_* 变量)与
 * 回调通道 loadJsonp(东财 push2 系:cb= 参数真调全局回调)共享注入生命周期单点——
 * 创建、8s 超时、settled 旗、清理(摘 script、删回调、摘 abort 监听)。
 * 域知识(URL/fields 拼接、parse、防抖、竞态序号守卫、queryKey/轮询节奏)一律留调用方。
 */

/** 各消费方现状同值;无差异需求不开参数旋钮(对齐 backend FETCH_TIMEOUT 先例)。 */
const SCRIPT_TIMEOUT = 8000

interface InjectOptions {
  /** 外部取消(标的检索 effect cleanup):abort 即摘 script 并以 signal.reason reject */
  signal?: AbortSignal
  /** 注入前挂载(回调通道:须先挂 window 回调再 appendChild,上游求值即回调) */
  beforeInject?: (settle: (finish: () => void) => void) => void
  /** onload 成功路径(var 通道;回调通道上游在求值期已回调,onload 无事可做) */
  onLoad?: (settle: (finish: () => void) => void) => void
  /** 落定时的额外清理(回调通道:delete window 回调,防泄漏) */
  cleanupExtra?: () => void
}

/** 注入生命周期内核:失败路径(超时/onerror/中止)统一在此,成功路径经 settle 上交各通道。 */
function inject(reject: (err: unknown) => void, opts: InjectOptions, src: string): void {
  const { signal } = opts
  if (signal?.aborted) {
    reject(signal.reason) // abort() 后 reason 恒有值(未传则浏览器/Node 填 AbortError)
    return
  }
  const s = document.createElement('script')
  let settled = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const onAbort = () => settle(() => reject(signal?.reason))
  const settle = (finish: () => void) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    s.remove()
    signal?.removeEventListener('abort', onAbort)
    opts.cleanupExtra?.()
    finish()
  }
  timer = setTimeout(() => settle(() => reject(new Error('script 加载超时'))), SCRIPT_TIMEOUT)
  s.onerror = () => settle(() => reject(new Error('script 加载失败')))
  signal?.addEventListener('abort', onAbort)
  const onLoad = opts.onLoad
  if (onLoad) s.onload = () => onLoad(settle)
  opts.beforeInject?.(settle)
  s.src = src
  document.body.appendChild(s)
}

/** var 通道:script onload 后读全局变量(求值期已同步赋值);缺失/非串兜底空串。 */
export function loadVarScript(
  url: string,
  vars: string[],
  signal?: AbortSignal,
): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    inject(
      reject,
      {
        signal,
        onLoad: (settle) =>
          settle(() => {
            const w = window as unknown as Record<string, unknown>
            const out: Record<string, string> = {}
            vars.forEach((k) => (out[k] = typeof w[k] === 'string' ? (w[k] as string) : ''))
            resolve(out)
          }),
      },
      url,
    )
  })
}

/** 回调通道:cb 名内核生成、用毕即删;调用方以 cb 名拼最终 URL(东财 push2 系 cb= 真回调)。 */
export function loadJsonp(
  buildUrl: (cb: string) => string,
  signal?: AbortSignal,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const cb = `__jsonp_${Math.random().toString(36).slice(2)}`
    const w = window as unknown as Record<string, ((obj: unknown) => void) | undefined>
    inject(
      reject,
      {
        signal,
        beforeInject: (settle) => {
          w[cb] = (obj: unknown) => settle(() => resolve(obj))
        },
        cleanupExtra: () => delete w[cb],
      },
      buildUrl(cb),
    )
  })
}
