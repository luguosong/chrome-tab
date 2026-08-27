// [DEBUG-trendzh] 一次性诊断:weekly/monthly 榜单「未翻译」条目的形态分拣。
// 红 = 无汉字却无译文(真 bug 面);蓝 = 含汉字被启发式跳过(ADR-0030 设计内)。
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const fs = await import('node:fs')

const sha256 = (s) => require('node:crypto').createHash('sha256').update(s, 'utf8').digest('hex')
const HAS_HAN = /[一-鿿]/
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36'

// 解析层复刻生产口径(trending.ts parseTrending):同款 cheerio + 选择器,
// 生产同构才能保证「这里红 = 产品真红」。cheerio 从 pnpm store 绝对路径加载。
const chPkg = JSON.parse(fs.readFileSync('/app/node_modules/.pnpm/node_modules/cheerio/package.json', 'utf8'))
const cheerio = require(`/app/node_modules/.pnpm/cheerio@${chPkg.version}/node_modules/cheerio`)

function parseTrending(html) {
  const $ = cheerio.load(html)
  const out = []
  $('article.Box-row').each((_, el) => {
    const href = $(el).find('h2 a').first().attr('href')
    if (!href?.startsWith('/')) return
    const desc = $(el).find('p').first().text().replace(/\s+/g, ' ').trim()
    out.push({ repo: href.replace(/^\//, ''), desc })
  })
  return out
}

async function fetchList(since) {
  const url = since === 'daily' ? 'https://github.com/trending' : `https://github.com/trending?since=${since}`
  const beganAt = Date.now()
  const resp = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
    signal: AbortSignal.timeout(25_000),
  })
  const html = await resp.text()
  console.log(`\n== ${since}: HTTP ${resp.status}, ${html.length}B, ${Date.now() - beganAt}ms ==`)
  if (resp.status !== 200) throw new Error(`HTTP ${resp.status}`)
  return parseTrending(html)
}

// better-sqlite3 绝对路径 require(live-diagnosis.md 口径)
const pkgJson = JSON.parse(fs.readFileSync('/app/node_modules/.pnpm/node_modules/better-sqlite3/package.json', 'utf8'))
const Database = require(`/app/node_modules/.pnpm/better-sqlite3@${pkgJson.version}/node_modules/better-sqlite3`)
const db = new Database('/app/backend/data/newtab.db', { readonly: true })

function knownTranslations(descriptions) {
  const map = new Map()
  const hashes = [...new Set(descriptions.map((d) => sha256(d)))]
  for (let i = 0; i < hashes.length; i += 500) {
    const slice = hashes.slice(i, i + 500)
    const rows = db
      .prepare(`SELECT desc_hash, translated FROM trending_translations WHERE desc_hash IN (${slice.map(() => '?').join(',')})`)
      .all(...slice)
    for (const r of rows) map.set(r.desc_hash, r.translated)
  }
  return map
}

for (const since of ['daily', 'weekly', 'monthly']) {
  let repos
  try {
    repos = await fetchList(since)
  } catch (e) {
    console.log(`   [${since}] 抓取失败:${e.message}`)
    continue
  }
  const withDesc = repos.filter((r) => r.desc)
  const zh = knownTranslations(withDesc.map((r) => r.desc))
  const noHanNoZh = []
  const hanSkipped = []
  for (const r of withDesc) {
    if (HAS_HAN.test(r.desc)) hanSkipped.push(r)
    else if (!zh.has(sha256(r.desc))) noHanNoZh.push(r)
  }
  console.log(
    `   条目 ${repos.length},带描述 ${withDesc.length};已译 ${[...new Set(withDesc.filter((r) => !HAS_HAN.test(r.desc)).map((r) => r.desc))].filter((d) => zh.has(sha256(d))).length}` +
      `,红(无汉字无译文)${noHanNoZh.length},蓝(含汉字跳过)${hanSkipped.length}`,
  )
  for (const r of hanSkipped)
    console.log(`   [蓝·含汉字] ${r.repo} :: ${r.desc.slice(0, 70)}`)
  for (const r of noHanNoZh)
    console.log(`   [红·该译未译] ${r.repo} :: ${r.desc.slice(0, 70)} :: ${sha256(r.desc).slice(0, 12)}`)
}
