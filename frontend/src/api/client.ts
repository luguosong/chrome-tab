export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

/**
 * 「从未取到」(CONTEXT.md 词条):后端从未成功从上游取得过任何一版数据,wire
 * 形状 HTTP 200 + null body。区别于网络错(ApiError)——retry 谓词据此不重试
 * (cachedOrNull 失败不落缓存,重试真打上游;「从未成功」是分钟级持续失败,
 * 翻盘概率远低于双请求 + 1s 退避的成本,自愈交轮询与手动重试,ADR-0049)。
 */
export class NeverFetchedError extends Error {
  constructor() {
    super('后端从未取到数据(200 + null)')
  }
}

/**
 * 顶层 T|null 协议的取数归一(ADR-0049):aihot×3 与 todo 的 queryFn 经此声明
 * 「null 即失败」,消费端只面对 isPending / isError 二态,data 不再有 null 臂。
 * 区别于 useWeather 的桶内 null(Record 值级部分失败,不适用)。对偶命名自
 * backend common.ts 的 cachedOrNull(OrNull 表形状)。
 */
export async function fetchNonNull<T>(path: string): Promise<T> {
  const v = await apiFetch<T | null>(path)
  if (v === null) throw new NeverFetchedError()
  return v
}

/**
 * retry 谓词:「从未取到」不重试,其余保原 `retry: 1` 语义(第 0 次失败后重试
 * 一次,此后停)。谓词形式无独立上限(retryer 全凭返回值),count < 1 即上限。
 */
export function retryUnlessNeverFetched(count: number, err: unknown): boolean {
  return !(err instanceof NeverFetchedError) && count < 1
}

/** 统一 fetch 封装：带 cookie、JSON、401/错误抛 ApiError。 */
export async function apiFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const r = await fetch(path, {
    credentials: 'include',
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  })
  if (!r.ok) {
    let msg = r.statusText
    try {
      const j = await r.json()
      msg = j?.message ?? msg
    } catch {
      /* 非 JSON 错误体，沿用 statusText */
    }
    throw new ApiError(r.status, msg)
  }
  if (r.status === 204 || !r.headers.get('content-type')?.includes('json')) {
    // 空体成功响应(如 logout 的幂等化 200 空体)不解析,否则 r.json() 对空串抛错
    return undefined as T
  }
  return (await r.json()) as T
}
