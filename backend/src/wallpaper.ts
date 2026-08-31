import type { Handler } from 'hono'
import type { AuthEnv } from './auth'
import { FETCH_TIMEOUT, fetchJson as prodFetchJson } from './common'

/**
 * 必应每日壁纸代理(契约 §8):代理 HPImageArchive 规避 CORS,拼完整 1920x1080 图 URL 下发。
 * 缓存按天失效(修正白名单③,修正 Java 版「cached 非空即返回、进程内永不失效」的缺失):
 * 北京日界变化才重拉,重拉失败沿用旧值;无缓存且失败 → 抛错走 500「服务器错误」。
 * 取数经 fetchJson 原语(超时防挂起 + 非 2xx 抛,ADR-0045 补收)。
 */

const BING_URL = 'https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=zh-CN'

export interface WallpaperDto {
  url: string
  copyright: string
  date: string
}

/** 依赖注入缝(测试不打真网、可控日界);缺省即 common 原语 / Date.now */
export interface WallpaperDeps {
  fetchJson?: (url: string, timeoutMs: number) => Promise<unknown>
  now?: () => number
}

/** yyyyMMdd(Asia/Shanghai)——必应 zh-CN 市场的 enddate 同格式日键 */
function beijingDayKey(epochMs: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(new Date(epochMs))
    .replaceAll('-', '')
}

export function createWallpaperHandler(deps: WallpaperDeps = {}): Handler<AuthEnv> {
  const fetchJson = deps.fetchJson ?? prodFetchJson
  const now = deps.now ?? Date.now
  // 存拉取时的日键而非 value.date:防必应端日期偶发偏差导致逐请求重打上游
  let cached: { value: WallpaperDto; day: string } | null = null

  return async (c) => {
    const day = beijingDayKey(now())
    if (cached && cached.day === day) return c.json(cached.value)
    try {
      const body = (await fetchJson(BING_URL, FETCH_TIMEOUT)) as {
        images?: Array<{ urlbase?: string; copyright?: string; enddate?: string }>
      }
      const img = body?.images?.[0]
      if (!img) throw new Error('必应壁纸响应不含 images')
      const value: WallpaperDto = {
        url: `https://www.bing.com${img.urlbase}_1920x1080.jpg`,
        copyright: img.copyright ?? '',
        date: img.enddate ?? '',
      }
      cached = { value, day }
      return c.json(value)
    } catch (e) {
      if (cached) {
        console.warn(`必应壁纸换新失败,沿用旧值(${cached.value.date}): ${e}`)
        return c.json(cached.value)
      }
      throw e // 无缓存 → 兜底 500「服务器错误」
    }
  }
}
