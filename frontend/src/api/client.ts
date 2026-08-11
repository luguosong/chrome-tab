export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
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
  if (r.status === 204) return undefined as T
  return (await r.json()) as T
}
