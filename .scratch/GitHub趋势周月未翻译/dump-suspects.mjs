// [DEBUG-trendzh] dump 周月榜 3 条「含汉字跳过」条目的完整描述 + 库内译文状态
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const fs = await import('node:fs')
const sha256 = (s) => require('node:crypto').createHash('sha256').update(s, 'utf8').digest('hex')

const chPkg = JSON.parse(fs.readFileSync('/app/node_modules/.pnpm/node_modules/cheerio/package.json', 'utf8'))
const cheerio = require(`/app/node_modules/.pnpm/cheerio@${chPkg.version}/node_modules/cheerio`)
const pkgJson = JSON.parse(fs.readFileSync('/app/node_modules/.pnpm/node_modules/better-sqlite3/package.json', 'utf8'))
const Database = require(`/app/node_modules/.pnpm/better-sqlite3@${pkgJson.version}/node_modules/better-sqlite3`)
const db = new Database('/app/backend/data/newtab.db', { readonly: true })

for (const since of ['weekly', 'monthly']) {
  const resp = await fetch(`https://github.com/trending?since=${since}`, {
    headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36' },
    signal: AbortSignal.timeout(25_000),
  })
  const $ = cheerio.load(await resp.text())
  console.log(`\n===== ${since} =====`)
  $('article.Box-row').each((_, el) => {
    const href = $(el).find('h2 a').first().attr('href') ?? ''
    const desc = $(el).find('p').first().text().replace(/\s+/g, ' ').trim()
    if (!/[一-鿿]/.test(desc)) return
    const row = db.prepare('SELECT translated FROM trending_translations WHERE desc_hash = ?').get(sha256(desc))
    console.log(`${href}\n   描述(${desc.length}字符): ${desc}`)
    console.log(`   库内译文: ${row ? JSON.stringify(row.translated) : '(无行)'}`)
  })
}
