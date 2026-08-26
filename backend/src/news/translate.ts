import type { NewsSourceId } from 'chrome-tab-shared'
import { makeBatchTranslator, type BatchTranslator } from '../translate'

/**
 * 新闻英文源标题译制(ADR-0029,CONTEXT.md「新闻」+「译文表」):域特化层——
 * system prompt 与源清单;批量机制(候选链/编号协议/限流纪律)与译文表存储(load/
 * save/ensure,ADR-0034)在 ../translate.ts。译文按标题哈希持久化(news_translations),
 * 同标题跨条目跨源终身只译一次;漏行/畸行返回 null 由 pollSource 轮次重试(30min
 * 免费回路)。译制只认源清单(TRANSLATED_SOURCES),否决逐条语言检测(ADR-0029)。
 */

/** 需要译制的英文源(按源硬编码,新英文源加一行;NewsSourceId 锁拼写进编译器)。 */
export const TRANSLATED_SOURCES: ReadonlySet<NewsSourceId> = new Set(['hackernews', 'producthunt'])

/** 译制系统提示(ADR-0029 第 7 条口径:前缀/标注原样,专名/emoji/定价词原样,不扩写)。 */
const NEWS_SYSTEM_PROMPT = `你是专业技术新闻编辑。把用户给出的编号英文标题列表逐条译成简体中文,输出同样编号的中文标题列表。
严格约束：
1. 输出与输入逐条对应：每行「序号. 译文」,不添加任何解释、前后缀,也不要代码围栏。
2. Show HN:、Ask HN:、Tell HN: 等开头前缀与 [video]、[pdf] 等方括号标注保留英文原样,只译正文。
3. 专有名词、产品名、公司名、代码标识符、API 名保留英文原样。
4. emoji、数字、定价词（$5、free 等）原样保留。
5. 译文简洁贴近原题长度,不扩写不解释。`

/** 批量标题译制器(别名:news 域语汇;机制与签名同 BatchTranslator)。 */
export type TitleTranslator = BatchTranslator

/** 生产译制器(候选链/无 Key 拒绝等行为见 makeBatchTranslator 注释)。 */
export function prodTitleTranslator(env: NodeJS.ProcessEnv = process.env): TitleTranslator {
  return makeBatchTranslator(NEWS_SYSTEM_PROMPT, 'news-translate', env)
}
