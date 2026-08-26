import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  clsSignedQuery,
  decodeGb2312,
  normalizeSecond,
  parseBeijingSecond,
  parseRelativeSecond,
  parseRssItems,
} from './parse'
import { parseBaidu } from './sources/baidu'
import { parseCls } from './sources/cls'
import { parseGithub } from './sources/github'
import { parseHackernews } from './sources/hackernews'
import { parseIthome } from './sources/ithome'
import { parseThepaper } from './sources/thepaper'
import { parseV2ex } from './sources/v2ex'
import { parseWeibo } from './sources/weibo'
import { parseZaobao } from './sources/zaobao'
import { parseZhihu } from './sources/zhihu'

/** 解析层 fixture 测试(spec「测试」节):形态差异大的源各留一条断路告警,共享小件全覆盖。 */

describe('parse 共享小件', () => {
  it('normalizeSecond:毫秒/秒/无效归一', () => {
    expect(normalizeSecond(1756200000000)).toBe(1756200000)
    expect(normalizeSecond('1756200000')).toBe(1756200000)
    expect(normalizeSecond(123)).toBeNull()
    expect(normalizeSecond('x')).toBeNull()
  })

  it('parseRelativeSecond:刚刚/相对量词/今天昨天墙钟/垃圾', () => {
    const now = Date.parse('2026-08-26T12:00:00Z') // 北京 20:00
    expect(parseRelativeSecond('刚刚', now)).toBe(now / 1000)
    expect(parseRelativeSecond('10分钟前', now)).toBe(now / 1000 - 600)
    expect(parseRelativeSecond('2小时14分钟前', now)).toBe(now / 1000 - 8040) // 复合量词(ithome 实测形态)
    expect(parseRelativeSecond('2小时前', now)).toBe(now / 1000 - 7200)
    expect(parseRelativeSecond('3天前', now)).toBe(now / 1000 - 259200)
    // 北京时间墙钟:今天 18:03 = UTC 10:03;昨天 18:03 = UTC 前日 10:03
    expect(parseRelativeSecond('今天 18:03', now)).toBe(Date.parse('2026-08-26T18:03:00+08:00') / 1000)
    expect(parseRelativeSecond('昨天 18:03', now)).toBe(Date.parse('2026-08-25T18:03:00+08:00') / 1000)
    expect(parseRelativeSecond('上周三', now)).toBeNull()
  })

  it('parseBeijingSecond:北京时间墙钟文本', () => {
    expect(parseBeijingSecond('2026-08-26 17:20:31')).toBe(Date.parse('2026-08-26T17:20:31+08:00') / 1000)
    expect(parseBeijingSecond('2026-08-26 12:03')).toBe(Date.parse('2026-08-26T12:03:00+08:00') / 1000)
    expect(parseBeijingSecond('n/a')).toBeNull()
  })

  it('decodeGb2312:字节流转码', () => {
    expect(decodeGb2312(new Uint8Array([0xd6, 0xd0]).buffer)).toBe('中')
  })

  it('clsSignedQuery:排序 + sha1→md5 双哈希链', () => {
    const qs = clsSignedQuery({ last_time: '100', refresh_type: '1', rn: '30' })
    const base = 'appName=CailianpressWeb&last_time=100&os=web&refresh_type=1&rn=30&sv=7.7.5'
    const sign = createHash('md5').update(createHash('sha1').update(base).digest('hex')).digest('hex')
    expect(qs).toBe(`${base}&sign=${sign}`)
  })

  it('parseRssItems:RSS 2.0 与 Atom 双形态', () => {
    const rss = parseRssItems(
      '<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>' +
        '<item><title>标题一</title><link>https://e/1</link><guid>g1</guid><pubDate>Wed, 26 Aug 2026 01:00:00 GMT</pubDate></item>' +
        '<item><title>无日期</title><link>https://e/2</link></item>' +
        '</channel></rss>',
    )
    expect(rss).toHaveLength(2)
    expect(rss[0]).toMatchObject({ id: 'g1', title: '标题一', url: 'https://e/1', publishedAt: Date.parse('2026-08-26T01:00:00Z') / 1000 })
    expect(rss[1]!.publishedAt).toBeNull()
    const atom = parseRssItems(
      '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>PH 标题</title>' +
        '<link rel="alternate" href="https://ph/1"/><id>p1</id><published>2026-08-26T00:00:00Z</published></entry></feed>',
    )
    expect(atom).toHaveLength(1)
    expect(atom[0]).toMatchObject({ id: 'p1', url: 'https://ph/1', publishedAt: Date.parse('2026-08-26T00:00:00Z') / 1000 })
    expect(parseRssItems('not xml')).toEqual([])
  })

  it('部署契约:源上游域全部进 compose NO_PROXY(国内直连)或境外代理白名单', () => {
    // 回归(2026-08-26 cls/wallstreetcn 等多源空 tab 事故):新闻 16 源上线时无一进
    // NO_PROXY,国内上游被全局 HTTPS_PROXY(mihomo)绑架出境,延迟尖刺叠 10s 超时
    // → 首取连轮失败 → 条目池空。新源忘了配直连,这里立刻红。
    const here = dirname(fileURLToPath(import.meta.url))
    const compose = readFileSync(join(here, '../../../docker-compose.prod.yml'), 'utf8')
    const noProxy = /NO_PROXY: (.+)/.exec(compose)![1]!.split(',').map((s) => s.trim())
    // 确需走代理出境的源(GFW 阻断);新增须在此登记并在源文件注释说明
    const proxied = ['github.com', 'news.ycombinator.com', 'producthunt.com']
    // 后缀匹配(条目剥前导点):`.sspai.com` 同时罩住裸域与任意子域
    const covers = (d: string, base: string) => d === base || d.endsWith(`.${base}`)
    const domains = new Set<string>()
    for (const f of readdirSync(join(here, 'sources'))) {
      if (!f.endsWith('.ts')) continue
      for (const m of readFileSync(join(here, 'sources', f), 'utf8').matchAll(/https?:\/\/([a-z0-9.-]+)[/'"]/g))
        domains.add(m[1]!)
    }
    expect(domains.size).toBeGreaterThanOrEqual(15) // 扫描坏了不许空集蒙混
    const uncovered = [...domains].filter(
      (d) => !proxied.some((p) => covers(d, p)) && !noProxy.some((p) => covers(d, p.replace(/^\./, ''))),
    )
    expect(uncovered).toEqual([])
  })
})

describe('源解析', () => {
  it('zhihu:热榜 JSON,无时间条目', () => {
    const items = parseZhihu({
      data: [{ target: { title_area: { text: '知乎热题' }, link: { url: 'https://www.zhihu.com/question/123456' } } }],
    })
    expect(items).toEqual([{ id: '123456', title: '知乎热题', url: 'https://www.zhihu.com/question/123456', publishedAt: null }])
  })

  it('baidu:s-data 内嵌 JSON,置顶剔除', () => {
    const html =
      '<html><!--s-data:{"data":{"cards":[{"content":[{"word":"置顶词","rawUrl":"https://b/1","isTop":true},{"word":"词条二","rawUrl":"https://b/2"}]}]}}--></html>'
    expect(parseBaidu(html)).toEqual([{ id: 'https://b/2', title: '词条二', url: 'https://b/2', publishedAt: null }])
    expect(parseBaidu('无标记页')).toEqual([])
  })

  it('weibo:热搜表格,首行表头跳过、javascript 链接滤除', () => {
    const html =
      '<div id="pl_top_realtimehot"><table><tbody>' +
      '<tr><td>表头</td></tr>' +
      '<tr><td class="td-02"><a href="/weibo?q=%E6%B5%8B%E8%AF%95">测试热搜</a></td></tr>' +
      '<tr><td class="td-02"><a href="javascript:void(0);">置顶</a></td></tr>' +
      '</tbody></table></div>'
    expect(parseWeibo(html)).toEqual([
      { id: '测试热搜', title: '测试热搜', url: 'https://s.weibo.com/weibo?q=%E6%B5%8B%E8%AF%95', publishedAt: null },
    ])
  })

  it('thepaper:pubTimeLong 毫秒归一', () => {
    expect(parseThepaper({ data: { hotNews: [{ contId: '123', name: '澎湃题', pubTimeLong: 1756200000000 }] } })).toEqual([
      { id: '123', title: '澎湃题', url: 'https://www.thepaper.cn/newsDetail_forward_123', publishedAt: 1756200000 },
    ])
  })

  it('ithome:广告过滤 + 相对时间/绝对墙钟双形态', () => {
    const html =
      '<div id="list"><div class="fl"><ul>' +
      '<li><a class="t" href="https://www.ithome.com/0/888/888.htm">正常标题</a><i>10分钟前</i></li>' +
      '<li><a class="t" href="https://www.ithome.com/0/888/889.htm">绝对时间条目</a><i>2026-08-26 11:14:21</i></li>' +
      '<li><a class="t" href="https://lapin.ithome.com/x">京东优惠</a><i>1小时前</i></li>' +
      '</ul></div></div>'
    const now = Date.parse('2026-08-26T04:00:00Z')
    const items = parseIthome(html, now)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ title: '正常标题', publishedAt: now / 1000 - 600 })
    // 实测列表页 50/50 为绝对北京墙钟(code-review 实探),必须能解析
    expect(items[1]).toMatchObject({ title: '绝对时间条目', publishedAt: Date.parse('2026-08-26T11:14:21+08:00') / 1000 })
  })

  it('hackernews:cheerio 选择器', () => {
    // <tr> 脱离 <table> 会被 HTML 解析器丢弃,fixture 需带 table 上下文
    const hn = parseHackernews('<table><tr class="athing" id="12345"><td class="title"><span class="titleline"><a href="x">HN 题</a></span></td></tr></table>')
    expect(hn).toEqual([{ id: '12345', title: 'HN 题', url: 'https://news.ycombinator.com/item?id=12345', publishedAt: null }])
  })

  it('cls:广告剔除 + ctime 秒透传', () => {
    const items = parseCls({ data: { roll_data: [{ id: 1, title: '电报题', ctime: 1756200000, is_ad: 0 }, { id: 2, brief: '广告', is_ad: 1 }] } })
    expect(items).toEqual([{ id: '1', title: '电报题', url: 'https://www.cls.cn/detail/1', publishedAt: 1756200000 }])
  })

  it('v2ex:date_modified 缺失时回落 date_published(实测 50 条仅 10-18 条有 modified)', () => {
    const items = parseV2ex([
      {
        items: [
          { id: 'a1', title: '有 modified', url: 'https://v2ex.com/t/a1', date_modified: '2026-08-26T03:00:00Z', date_published: '2026-08-25T00:00:00Z' },
          { id: 'a2', title: '仅有 published', url: 'https://v2ex.com/t/a2', date_published: '2026-08-26T05:00:00Z' },
        ],
      },
    ])
    expect(items[0]).toMatchObject({ id: 'a1', publishedAt: Date.parse('2026-08-26T03:00:00Z') / 1000 })
    expect(items[1]).toMatchObject({ id: 'a2', publishedAt: Date.parse('2026-08-26T05:00:00Z') / 1000 })
  })

  it('zaobao:括号日期剥除后按北京时间解析', () => {
    const html =
      '<div class="list-block">' +
      '<a class="item" href="/a/1"><div class="eps">早报标题</div><div class="pdt10">(2026-08-26 12:03)</div></a>' +
      '</div>'
    expect(parseZaobao(html)).toEqual([
      { id: '/a/1', title: '早报标题', url: 'https://www.zaochenbao.com/a/1', publishedAt: Date.parse('2026-08-26T12:03:00+08:00') / 1000 },
    ])
  })
})
