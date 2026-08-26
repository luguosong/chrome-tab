import { parseRssItems } from '../parse'
import { FETCH_TIMEOUT, newsHeaders, type NewsGetter } from './types'

/**
 * Product Hunt(newnow server/sources/producthunt.ts 移植,仅保留无 token 的 RSS
 * 回落路径——上游 GraphQL 路径需 PRODUCTHUNT_API_TOKEN,不引入新凭据)。Atom feed,
 * 逐条 published。
 */
const fetchProducthunt: NewsGetter = async (d) =>
  parseRssItems(await d.fetchText('https://www.producthunt.com/feed', FETCH_TIMEOUT, newsHeaders()))

export default fetchProducthunt
