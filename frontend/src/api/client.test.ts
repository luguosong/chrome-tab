import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiFetch, fetchNonNull, NeverFetchedError, retryUnlessNeverFetched } from './client'

/** 构造一个最小 Response 形状(fetch Response 在 Node 20+ 可直接用) */
const res = (status: number, body: string | null, contentType?: string) =>
  new Response(body ?? null, {
    status,
    headers: contentType ? { 'content-type': contentType } : {},
  })

afterEach(() => vi.unstubAllGlobals())

describe('apiFetch 响应体解析', () => {
  it('2xx JSON 照常解析', async () => {
    vi.stubGlobal('fetch', async () => res(200, '{"id":1,"username":"admin"}', 'application/json'))
    await expect(apiFetch('/api/login', { method: 'POST' })).resolves.toEqual({
      id: 1,
      username: 'admin',
    })
  })

  // 回归:logout 后端契约是 200 空体(auth.ts 幂等化),曾因 r.json() 抛
  // 「Unexpected end of JSON input」阻断 setUser(null),登出不跳转。
  it('204 与空体 2xx 一律返回 undefined,不调 json()', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => res(200, null)),
    )
    await expect(apiFetch<void>('/api/logout', { method: 'POST' })).resolves.toBeUndefined()
  })

  it('非 2xx 抛 ApiError 并取错误体 message', async () => {
    vi.stubGlobal('fetch', async () => res(401, '{"message":"未登录"}', 'application/json'))
    const err: ApiError = await apiFetch('/api/me').then(
      () => {
        throw new Error('应当抛错')
      },
      (e) => e,
    )
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(401)
    expect(err.message).toBe('未登录')
  })
})

describe('fetchNonNull:200-null「从未取到」归一为失败(ADR-0049)', () => {
  // wire 三态(200-null / error / T)是取数层知识;消费端只面对 isPending/isError
  it('null body 抛 NeverFetchedError(可区分,供 retry 谓词)', async () => {
    vi.stubGlobal('fetch', async () => res(200, 'null', 'application/json'))
    const err = await fetchNonNull('/api/todo').then(
      () => {
        throw new Error('应当抛错')
      },
      (e) => e,
    )
    expect(err).toBeInstanceOf(NeverFetchedError)
  })

  it('非 null 值照常透传', async () => {
    vi.stubGlobal('fetch', async () => res(200, '[{"rank":1}]', 'application/json'))
    await expect(fetchNonNull('/api/aihot/hot-topics')).resolves.toEqual([{ rank: 1 }])
  })
})

describe('retryUnlessNeverFetched:网络错照旧重试 1 次,从未取到不重试', () => {
  // 「从未成功」是分钟级持续失败(cachedOrNull 失败不落缓存,重试真打上游),
  // 1s 退避 + 双请求成本 > 翻盘收益;自愈交轮询与手动重试
  it('NeverFetchedError 恒不重试', () => {
    expect(retryUnlessNeverFetched(0, new NeverFetchedError())).toBe(false)
    expect(retryUnlessNeverFetched(2, new NeverFetchedError())).toBe(false)
  })

  it('其他错误保原 retry:1 语义——第 0 次失败后重试一次,此后停', () => {
    expect(retryUnlessNeverFetched(0, new ApiError(500, '网络错'))).toBe(true)
    expect(retryUnlessNeverFetched(1, new ApiError(500, '网络错'))).toBe(false)
  })
})

/**
 * 200-null 协议契约(ADR-0049):「顶层 T|null = 从未取到」的归一只在 fetchNonNull
 * 成立,前提是取数层没人绕开它直接声明 `| null` 泛型。镜像 scriptLoader.test 的
 * createElement 契约断言(ADR-0046)与 backend common.test 的裸 fetch 断言
 * (ADR-0045):把「grep 可断言」变成测试把关,防下一个域以裸 apiFetch<T|null>
 * 漏网。白名单:client.ts(fetchNonNull 自身)与 useWeather.ts(桶内 null 是
 * 分桶部分失败协议,另一物种——Record 值级 null 随批量响应部分成功;白名单是
 * 文件粒度,同文件的顶层 null 不可见,换文件即收网)。
 */
describe('200-null 协议契约:顶层 T|null 取数必经 fetchNonNull(ADR-0049)', () => {
  it('apiFetch 泛型行含 null 仅许白名单两文件(嵌套泛型顶层 null 亦不漏)', () => {
    const srcDir = fileURLToPath(new URL('../', import.meta.url))
    const allow = new Set(['api/client.ts', 'hooks/useWeather.ts'])
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = dir + name // dir 恒带尾斜杠(srcDir 与递归层皆是)
        if (statSync(p).isDirectory()) walk(p + '/')
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
          const rel = p.slice(srcDir.length)
          if (allow.has(rel)) continue
          const lines = readFileSync(p, 'utf8').split('\n')
          lines.forEach((line, i) => {
            // 行级匹配(apiFetch< 与 null 同行):跨 `>` 的嵌套泛型顶层 null
            // (apiFetch<Array<T> | null>)不漏;跨行泛型形状本仓无,出现即此测不收
            if (/apiFetch<[^\n]*null/.test(line))
              offenders.push(`${rel}:${i + 1}: ${line.trim()}`)
          })
        }
      }
    }
    walk(srcDir)
    expect(offenders).toEqual([])
  })

  it('fetchNonNull 的宿主文件必同时引 retryUnlessNeverFetched(用 helper 忘 retry 谓词即红)', () => {
    // 忘谓词的 hook 会拿到裸 QueryClient 默认 retry 3 次 + 退避(outage 期间每轮
    // 轮询 2-4 发真上游、失败 UI 迟 ~7s)——正是谓词要消灭的成本
    const srcDir = fileURLToPath(new URL('../', import.meta.url))
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = dir + name // dir 恒带尾斜杠(srcDir 与递归层皆是)
        if (statSync(p).isDirectory()) walk(p + '/')
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
          const rel = p.slice(srcDir.length)
          if (rel === 'api/client.ts') continue
          const text = readFileSync(p, 'utf8')
          if (/fetchNonNull/.test(text) && !/retryUnlessNeverFetched/.test(text))
            offenders.push(rel)
        }
      }
    }
    walk(srcDir)
    expect(offenders).toEqual([])
  })
})
