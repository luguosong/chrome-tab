import { Hono } from 'hono'
import type { AuthEnv } from './auth'
import { asRec, BadRequest, jsonBody, optInt, reqInt, touchVersion } from './common'
import type { Db } from './db'
import type { ImportantDate } from 'chrome-tab-shared'

/**
 * 布局设置 upsert(api-contract §3):有行则改、无行则建;可空字段缺省落 LayoutLimits 默认
 * (旧客户端/旧备份复用本请求体)。读经 GET /api/config 的 layoutSettings 字段,无独立读端点。
 * 写后 bump config_version(ADR-0006)。PUT /api/config 的 layoutSettings 覆盖复用 updateLayout。
 */

export const LAYOUT_DEFAULTS = {
  gridWidth: 1024,
  gridGap: 8,
  gridGapY: 8,
  panelFog: 36,
  searchBarWidth: 576,
  searchBarVisible: true,
  searchEngine: 'google',
  clockVisible: true,
  clockFont: 48,
  clock24h: true,
  labelVisible: true,
  labelSize: 12,
  labelColor: '#ffffff',
  importantDates: [] as ImportantDate[],
} as const

/** const 断言的字面量类型拓宽回基本型(默认值对象仅在缺省时使用,变量仍是宽类型)。
 *  非标量(如 ImportantDate[])原样保留——importantDates 例外地以结构值作默认。 */
type Widen<T> = {
  [K in keyof T]: T[K] extends boolean ? boolean : T[K] extends string ? string : T[K] extends number ? number : T[K]
}
type LayoutWire = Widen<typeof LAYOUT_DEFAULTS>

/** layout_settings 行(0/1 整数)→ 13 字段 wire(布尔);无行时返回 defaults()。 */
export async function readLayout(db: Db, userId: number): Promise<LayoutWire> {
  const row = await db.selectFrom('layout_settings').selectAll().where('user_id', '=', userId).executeTakeFirst()
  if (!row) return { ...LAYOUT_DEFAULTS }
  return {
    gridWidth: row.grid_width,
    gridGap: row.grid_gap,
    gridGapY: row.grid_gap_y,
    panelFog: row.panel_fog,
    searchBarWidth: row.search_bar_width,
    searchBarVisible: !!row.search_bar_visible,
    searchEngine: row.search_engine,
    clockVisible: !!row.clock_visible,
    clockFont: row.clock_font,
    clock24h: !!row.clock_24h,
    labelVisible: !!row.label_visible,
    labelSize: row.label_size,
    labelColor: row.label_color,
    importantDates: parseStoredDates(row.important_dates),
  }
}

/** 校验 + upsert(可空字段补默认);返回 13 字段 wire。调用方负责事务与 bump。 */
export async function updateLayout(db: Db, userId: number, body: Record<string, unknown>): Promise<LayoutWire> {
  // gridWidth 下限 768(ADR-0021 随 9×9 扩容上调,原 640):9 列轨道下图标不缩过旧 8 列
  // 最小档——「网格最小宽度变大,1×1 图标视觉不变」的容量侧配套。
  const gridWidth = reqInt(body, 'gridWidth', { range: { min: 768, max: 1536 } })
  const gridGap = reqInt(body, 'gridGap', { range: { min: 0, max: 24 } })
  const gridGapY = optInt(body, 'gridGapY', { range: { min: 0, max: 32 }, def: LAYOUT_DEFAULTS.gridGapY })
  const panelFog = optInt(body, 'panelFog', { range: { min: 0, max: 60 }, def: LAYOUT_DEFAULTS.panelFog })
  const searchBarWidth = optInt(body, 'searchBarWidth', { range: { min: 320, max: 1024 }, def: LAYOUT_DEFAULTS.searchBarWidth })
  const searchBarVisible = optBool(body, 'searchBarVisible', true)
  const searchEngine = optEngine(body)
  const clockVisible = optBool(body, 'clockVisible', true)
  const clockFont = optInt(body, 'clockFont', { range: { min: 28, max: 72 }, def: LAYOUT_DEFAULTS.clockFont })
  const clock24h = optBool(body, 'clock24h', true)
  const labelVisible = optBool(body, 'labelVisible', true)
  const labelSize = optInt(body, 'labelSize', { range: { min: 10, max: 16 }, def: LAYOUT_DEFAULTS.labelSize })
  const labelColor = optColor(body)
  const importantDates = optDates(body)

  const values = {
    grid_width: gridWidth,
    grid_gap: gridGap,
    grid_gap_y: gridGapY,
    panel_fog: panelFog,
    search_bar_width: searchBarWidth,
    search_bar_visible: searchBarVisible ? 1 : 0,
    search_engine: searchEngine,
    clock_visible: clockVisible ? 1 : 0,
    clock_font: clockFont,
    clock_24h: clock24h ? 1 : 0,
    label_visible: labelVisible ? 1 : 0,
    label_size: labelSize,
    label_color: labelColor,
    important_dates: JSON.stringify(importantDates),
  }
  await db
    .insertInto('layout_settings')
    .values({ user_id: userId, ...values })
    .onConflict((oc) => oc.column('user_id').doUpdateSet(values))
    .execute()
  return readLayout(db, userId)
}

export function layoutRoutes(db: Db) {
  return new Hono<AuthEnv>().put('/api/layout-settings', async (c) => {
    const userId = c.get('user')!.id
    const body = asRec(await jsonBody(c))
    if (!body) throw new BadRequest('请求体必须是布局设置对象')
    const layout = await db.transaction().execute(async (tx) => {
      const result = await updateLayout(tx, userId, body)
      await touchVersion(tx, userId)
      return result
    })
    return c.json(layout)
  })
}

// ── 域特有小件(bool/pattern/枚举/结构;int 族在 common,ADR-0048)──────────────

function optBool(b: Record<string, unknown>, key: string, def: boolean): boolean {
  const v = b[key]
  if (v === undefined || v === null) return def
  if (typeof v !== 'boolean') throw new BadRequest(`${key}: 必须是布尔值`)
  return v
}

// ── 重要日子(ADR-0026 寄放布局设置;CONTEXT.md「重要日子」)──────────────────

/** 存量行/坏 JSON 的读侧兜底:静默回落空列表(校验过的写入才会存进来)。 */
function parseStoredDates(raw: string | null): ImportantDate[] {
  if (!raw) return []
  try {
    const v: unknown = JSON.parse(raw)
    return Array.isArray(v) ? (v as ImportantDate[]) : []
  } catch {
    return []
  }
}

/** importantDates 可空字段:缺省 [](缺字段=清空,寄放字段随整份 LWW,ADR-0006/0026;
 *  旧客户端整份回写覆盖是 LWW 语义本身,跨端防丢靠本地镜像与和解);逐条结构校验
 *  (id/name 非空限长、date 形状与月日界限、枚举),违例 400。 */
function optDates(b: Record<string, unknown>): ImportantDate[] {
  const v = b.importantDates
  if (v === undefined || v === null) return []
  if (!Array.isArray(v)) throw new BadRequest('importantDates: 必须是数组')
  if (v.length > 100) throw new BadRequest('importantDates: 至多 100 条')
  return v.map((it) => {
    if (typeof it !== 'object' || it === null) throw new BadRequest('importantDates: 条目必须是对象')
    const d = it as Record<string, unknown>
    if (typeof d.id !== 'string' || !d.id || d.id.length > 64)
      throw new BadRequest('importantDates.id: 非空字符串且 ≤64 字符')
    if (typeof d.name !== 'string' || !d.name.trim() || d.name.length > 32)
      throw new BadRequest('importantDates.name: 非空字符串且 ≤32 字符')
    if (typeof d.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d.date))
      throw new BadRequest('importantDates.date: 须为 YYYY-MM-DD')
    // 月日界限:历法无关存储(农历日历本就无「公历真实日期」可言),只挡 13-45 类
    // 越界值;公历 2-30 等细粒度假日期由前端 Date 循环展示兜住,不追真历表
    const [, mm, dd] = d.date.split('-').map(Number)
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31)
      throw new BadRequest('importantDates.date: 月/日越界')
    if (d.calendar !== 'solar' && d.calendar !== 'lunar')
      throw new BadRequest('importantDates.calendar: 须为 solar 或 lunar')
    if (d.repeat !== 'annual' && d.repeat !== 'once')
      throw new BadRequest('importantDates.repeat: 须为 annual 或 once')
    return { id: d.id, name: d.name, date: d.date, calendar: d.calendar, repeat: d.repeat }
  })
}

function optEngine(b: Record<string, unknown>): string {
  const v = b.searchEngine
  if (v === undefined || v === null) return LAYOUT_DEFAULTS.searchEngine
  if (v !== 'google' && v !== 'bing' && v !== 'baidu') throw new BadRequest('searchEngine: 必须是 google|bing|baidu')
  return v
}

function optColor(b: Record<string, unknown>): string {
  const v = b.labelColor
  if (v === undefined || v === null) return LAYOUT_DEFAULTS.labelColor
  if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) throw new BadRequest('labelColor: 必须是 #rrggbb 十六进制色')
  return v
}
