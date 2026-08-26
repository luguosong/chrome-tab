import { parseRssItems } from '../parse'
import { FETCH_TIMEOUT, newsHeaders, type NewsGetter } from './types'

/** Solidot(newnow server/sources/solidot.ts 移植):官方 RSS 2.0,逐条 pubDate。 */
const fetchSolidot: NewsGetter = async (d) =>
  parseRssItems(await d.fetchText('https://www.solidot.org/index.rss', FETCH_TIMEOUT, newsHeaders()))

export default fetchSolidot
