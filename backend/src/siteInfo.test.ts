import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { ConflictError } from './common'
import { createSiteInfoHandler, parseSiteInfo } from './siteInfo'

// parseSiteInfo:HTML → {title, icon 候选} 纯函数(新增/编辑表单自动填充的数据源,
// 见 CONTEXT.md「站点信息」)。handler 直挂路由(不经 createApp,同 wallpaper.test.ts 先例):
// fetch 注入不打真网;401 横切由契约测试覆盖。

describe('parseSiteInfo', () => {
  const BASE = 'https://example.com/a/b'

  it('title + 绝对/相对 icon 均解析,相对地址按页面 URL 解析', () => {
    const html = `<head><title>Example Site</title>
      <link rel="icon" href="/favicon.ico">
      <link rel="apple-touch-icon" href="https://cdn.example.com/apple.png">
    </head>`
    expect(parseSiteInfo(html, BASE)).toEqual({
      title: 'Example Site',
      icons: ['https://example.com/favicon.ico', 'https://cdn.example.com/apple.png'],
    })
  })

  it('rel 多 token(shortcut icon)也算 icon;单双引号均可', () => {
    const html = `<link rel="shortcut icon" href='/f.ico'>`
    expect(parseSiteInfo(html, BASE).icons).toEqual(['https://example.com/f.ico'])
  })

  it('HTML5 无引号属性值也认', () => {
    const html = `<link rel=icon href=/f.ico>`
    expect(parseSiteInfo(html, BASE).icons).toEqual(['https://example.com/f.ico'])
  })

  it('非 icon rel(stylesheet/manifest/preconnect)忽略', () => {
    const html = `<link rel="stylesheet" href="/a.css">
      <link rel="manifest" href="/manifest.json">
      <link rel="preconnect" href="https://cdn.example.com">
      <link rel="icon" href="/ok.ico">`
    expect(parseSiteInfo(html, BASE).icons).toEqual(['https://example.com/ok.ico'])
  })

  it('同 URL 去重,保持文档序', () => {
    const html = `<link rel="icon" href="/f.ico">
      <link rel="apple-touch-icon" href="https://cdn.example.com/x.png">
      <link rel="icon" href="/f.ico">`
    expect(parseSiteInfo(html, BASE).icons).toEqual([
      'https://example.com/f.ico',
      'https://cdn.example.com/x.png',
    ])
  })

  it('title 实体解码 + 空白折叠;内嵌标签剥除', () => {
    const html = `<title>  A &amp; B&nbsp;&lt;x&gt;\n  C </title>`
    expect(parseSiteInfo(html, BASE).title).toBe('A & B <x> C')
    expect(parseSiteInfo(`<title>Pre<title-broken>Post</title>`, BASE).title).toBe('PrePost')
  })

  it('数字实体(&#39; / &#x27;)解码', () => {
    expect(parseSiteInfo(`<title>It&#39;s &#x22;ok&#x22;</title>`, BASE).title).toBe(
      `It's "ok"`,
    )
  })

  it('畸形 href / 无 title 无 link → 空结果不抛', () => {
    expect(parseSiteInfo('', BASE)).toEqual({ title: '', icons: [] })
    expect(parseSiteInfo(`<link rel="icon" href="http://[broken">`, BASE).icons).toEqual([])
    expect(parseSiteInfo(`<link rel="icon">`, BASE).icons).toEqual([])
  })
})

describe('GET /api/site-info', () => {
  const PAGE = `<title>百度一下</title><link rel="icon" href="/favicon.ico">`

  /** fetch 桩 + 直挂路由(镜像 app.ts 兜底形状;接线统一落在 createApp) */
  function makeApp() {
    const calls: string[] = []
    let respond: () => Response = () => new Response('boom', { status: 503 })
    const fetchFn: typeof fetch = async (input) => {
      calls.push(String(input))
      return respond()
    }
    const app = new Hono().get('/api/site-info', createSiteInfoHandler({ fetchFn }))
    // 镜像 app.ts 兜底形状(接线统一落在 createApp)
    app.onError((err, c) => {
      if (err instanceof ConflictError)
        return c.json({ status: err.status, message: err.message }, err.status as never)
      return c.json({ status: 500, message: '服务器错误' }, 500)
    })
    const get = (url = '/api/site-info?url=https://example.com/') => app.request(url)
    return {
      calls,
      stub: (r: () => Response) => (respond = r),
      get,
    }
  }

  it('200:title + 按 baseUrl 解析后的 icon 候选', async () => {
    const { stub, get } = makeApp()
    stub(() => new Response(PAGE, { headers: { 'content-type': 'text/html' } }))
    const res = await get()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      title: '百度一下',
      icons: ['https://example.com/favicon.ico'],
    })
  })

  it('同 url 二连发命中缓存:零外呼、同值', async () => {
    const { calls, stub, get } = makeApp()
    stub(() => new Response(PAGE))
    await get()
    const second = await get()
    expect(second.status).toBe(200)
    await expect(second.json()).resolves.toEqual({
      title: '百度一下',
      icons: ['https://example.com/favicon.ico'],
    })
    expect(calls).toHaveLength(1)
  })

  it('url 缺失 → 400;非 http(s) 协议 → 400(不打网)', async () => {
    const { calls, get } = makeApp()
    expect((await get('/api/site-info')).status).toBe(400)
    expect((await get('/api/site-info?url=ftp://x/')).status).toBe(400)
    expect((await get('/api/site-info?url=javascript:alert(1)')).status).toBe(400)
    expect(calls).toHaveLength(0)
  })

  it('上游 5xx → 500(错误体 {status, message})', async () => {
    const { get } = makeApp() // 默认桩 503
    const res = await get()
    expect(res.status).toBe(500)
    const body = (await res.json()) as { status: number; message: string }
    expect(body.status).toBe(500)
  })
})
