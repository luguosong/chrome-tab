import type { NewsSourceId } from 'chrome-tab-shared'
import baidu from './baidu'
import cankaoxiaoxi from './cankaoxiaoxi'
import cls from './cls'
import github from './github'
import hackernews from './hackernews'
import ithome from './ithome'
import kr36 from './36kr'
import producthunt from './producthunt'
import solidot from './solidot'
import sspai from './sspai'
import thepaper from './thepaper'
import v2ex from './v2ex'
import wallstreetcn from './wallstreetcn'
import weibo from './weibo'
import zaobao from './zaobao'
import zhihu from './zhihu'
import type { NewsGetter } from './types'

/**
 * 源注册表:NewsSourceId(shared 枚举)→ 抓取 getter,一一对应。新增源 = shared
 * newsSources.ts 加枚举 + 本目录加文件 + 此处登记,三处同改(代码即配置)。
 */
export const NEWS_GETTERS: Record<NewsSourceId, NewsGetter> = {
  zhihu,
  weibo,
  baidu,
  thepaper,
  ithome,
  '36kr': kr36,
  sspai,
  solidot,
  github,
  hackernews,
  v2ex,
  producthunt,
  cls,
  wallstreetcn,
  zaobao,
  cankaoxiaoxi,
}
