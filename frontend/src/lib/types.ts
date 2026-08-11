export type Me = { id: number; username: string }

export type NavLink = { id: number; name: string; url: string; sortOrder: number }

export type StockWatch = {
  id: number
  symbol: string
  name: string
  groupName: string
  sortOrder: number
}

export type Setting = { theme: string }

/** GET /api/config 聚合响应 */
export type Config = {
  navLinks: NavLink[]
  stockWatches: StockWatch[]
  setting: Setting
}
