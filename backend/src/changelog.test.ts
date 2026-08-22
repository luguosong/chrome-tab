import { beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './app'
import { openDb, type Db } from './db'
import { bootstrap } from './seed'
import {
  extractContent,
  ChangelogService,
  splitBlocks,
  type ChangelogDeps,
} from './changelog'

// 语义源 = Java ChangelogSlicerTest / ChangelogServiceTest / ChangelogControllerTest,
// 重译底稿 .scratch/backend-rewrite/test-align-map.md §changelog。fixture:内存 SQLite + 假协作器,零外呼。

const RAW = '# Changelog\n\n## 3.0\n- three\n\n## 2.0\n- two\n\n## 1.0\n- one\n'

/** 逐块桩(照 Java):每块恰好含一个关键词,译制 = 关键词换中文;未知块抛错。 */
const TRANSLATOR = (block: string): string => {
  const pairs: [string, string][] = [
    ['three', '三'],
    ['two', '二'],
    ['one', '一'],
    ['four', '四'],
  ]
  for (const [en, zh] of pairs) if (block.includes(en)) return block.replaceAll(en, zh)
  throw new Error(`未知块: ${block}`)
}

function makeService(db: Db, deps: Partial<ChangelogDeps> = {}, translateRecent = 2) {
  const defaults: ChangelogDeps = {
    fetchMarkdown: async () => RAW,
    translate: async (b) => TRANSLATOR(b),
    fetchReleasedAt: async () => null,
  }
  return new ChangelogService(db, { ...defaults, ...deps }, translateRecent)
}

describe('splitBlocks(块边界即哈希边界,错一字符即失配)', () => {
  it('切成前缀 + 文档序块列表,块原文含标题行到下一版本标题前(含块间空行)', () => {
    const b = splitBlocks(RAW)
    expect(b.prefix).toBe('# Changelog\n\n')
    expect(b.blocks.map((x) => x.title)).toEqual(['3.0', '2.0', '1.0']) // 新 → 旧
    expect(b.blocks[0]!.raw).toBe('## 3.0\n- three\n\n')
    expect(b.blocks[2]!.raw).toBe('## 1.0\n- one\n')
  })

  it('h3 标题归属当前版本块,不算版本起点', () => {
    const b = splitBlocks('## 1.0\n### Features\n- x\n')
    expect(b.prefix).toBe('')
    expect(b.blocks).toHaveLength(1)
    expect(b.blocks[0]!.raw).toBe('## 1.0\n### Features\n- x\n')
  })

  it('无版本标题:整篇作前缀,无版本块', () => {
    const b = splitBlocks('# 只有标题\n正文\n')
    expect(b.prefix).toBe('# 只有标题\n正文\n')
    expect(b.blocks).toEqual([])
  })

  it('title 去掉 ## 前缀(与前端 parseChangelog 的 h[1].trim() 同规则)', () => {
    expect(splitBlocks('## 2.0.14\n- x\n').blocks[0]!.title).toBe('2.0.14')
  })
})

describe('ChangelogService 编排(ADR-0017)', () => {
  it('冷 get:只译最近 N 版,快照落库,releasedAt null 不阻塞', async () => {
    const db = openDb(':memory:').db
    const s = makeService(db)

    const snap = await s.get()

    expect(snap.markdown).toContain('三')
    expect(snap.markdown).toContain('二')
    expect(snap.markdown).toContain('- one') // 1.0 窗口外保持英文
    expect(snap.translatedVersions).toEqual(['3.0', '2.0'])
    const rows = await db.selectFrom('changelog_translations').selectAll().execute()
    expect(rows).toHaveLength(2)
    const snapshotRow = await db.selectFrom('changelog_snapshot').selectAll().executeTakeFirst()
    expect(snapshotRow?.raw_markdown).toBe(RAW)
    expect(snapshotRow?.released_at).toBeNull()
  })

  it('同一原文再次 refresh:块哈希全命中 → 零 LLM 调用', async () => {
    const db = openDb(':memory:').db
    let calls = 0
    const s = makeService(db, { translate: async (b) => (calls++, TRANSLATOR(b)) })

    await s.get()
    await s.refresh() // 模拟 6h 定时周期,原文未变

    expect(calls).toBe(2)
  })

  it('新版本到来:只译哈希缺失的新块;落出窗口的旧版译文继续生效(永久保留)', async () => {
    const db = openDb(':memory:').db
    const feed = [
      '# Changelog\n\n## 3.0\n- three\n\n## 2.0\n- two\n',
      '# Changelog\n\n## 4.0\n- four\n\n## 3.0\n- three\n\n## 2.0\n- two\n',
    ]
    let idx = 0
    let calls = 0
    const s = makeService(db, {
      fetchMarkdown: async () => feed[Math.min(idx++, feed.length - 1)]!,
      translate: async (b) => (calls++, TRANSLATOR(b)),
    })

    await s.get() // 首轮:3.0、2.0 两块
    await s.refresh() // 4.0 到来:窗口=4.0/3.0,仅 4.0 缺失

    expect(calls).toBe(3)
    const snap = await s.get()
    expect(snap.markdown).toContain('四')
    expect(snap.markdown).toContain('三')
    expect(snap.markdown).toContain('二') // 2.0 已出窗仍中文
    expect(snap.translatedVersions).toEqual(['4.0', '3.0', '2.0'])
  })

  it('译制失败:该版保持英文、行不入库;下一轮定时刷新自动重试成功', async () => {
    const db = openDb(':memory:').db
    let calls = 0
    const s = makeService(db, {
      translate: async (b) => {
        if (++calls <= 2) throw new Error('LLM 宕机') // 首轮两块全失败
        return TRANSLATOR(b)
      },
    })

    expect((await s.get()).markdown).toBe(RAW) // 全部透传英文
    expect(await db.selectFrom('changelog_translations').selectAll().execute()).toHaveLength(0)

    await s.refresh() // 下一 6h 周期重试成功
    expect((await s.get()).markdown).toContain('三')
    expect((await s.get()).markdown).toContain('二')
  })

  it('Key 缺失(translate 返回 null):拒绝译制,保持英文不入库', async () => {
    const db = openDb(':memory:').db
    const s = makeService(db, { translate: async () => null })

    const snap = await s.get()

    expect(snap.markdown).toBe(RAW)
    expect(snap.translatedVersions).toEqual([])
    expect(await db.selectFrom('changelog_translations').selectAll().execute()).toHaveLength(0)
  })

  it('冷启动且拉取失败:get 上抛(→ HTTP 500,前端重试)', async () => {
    const db = openDb(':memory:').db
    const s = makeService(db, { fetchMarkdown: async () => { throw new Error('GitHub 不可达') } })

    await expect(s.get()).rejects.toThrow('GitHub 不可达')
  })

  it('定时刷新失败:异常止于调度方,内存快照照常服务(不空窗)', async () => {
    const db = openDb(':memory:').db
    let networkUp = true
    const s = makeService(db, {
      fetchMarkdown: async () => {
        if (!networkUp) throw new Error('GitHub 不可达')
        return RAW
      },
    })

    await s.get() // 建立快照
    networkUp = false
    await expect(s.refresh()).rejects.toThrow('GitHub 不可达')

    expect((await s.get()).markdown).toContain('三') // 沿用旧快照
  })

  it('重启恢复:loadFromDb 从快照表重建镜像,零外呼零 LLM', async () => {
    const db = openDb(':memory:').db
    await makeService(db).get() // 前一进程:建库
    expect(await db.selectFrom('changelog_snapshot').selectAll().executeTakeFirst()).toBeDefined()

    let llmCalls = 0
    const restarted = makeService(db, {
      fetchMarkdown: async () => { throw new Error('重启后 GitHub 不可达') }, // 任何外呼即失败
      translate: async (b) => (llmCalls++, TRANSLATOR(b)),
    })
    await restarted.loadFromDb()

    expect((await restarted.get()).markdown).toContain('三')
    expect((await restarted.get()).markdown).toContain('二')
    expect(llmCalls).toBe(0)
  })

  it('按需补译:指定旧版 → 译一块、入库、重拼;重复请求哈希命中零 LLM', async () => {
    const db = openDb(':memory:').db
    const s = makeService(db)
    await s.get() // 3.0、2.0 已译

    const snap = await s.translateVersions(['1.0'])

    expect(snap.markdown).toContain('一')
    expect(snap.translatedVersions).toContain('1.0')
    expect(await db.selectFrom('changelog_translations').selectAll().execute()).toHaveLength(3)

    await s.translateVersions(['1.0']) // 已译 → 零调用
    expect(await db.selectFrom('changelog_translations').selectAll().execute()).toHaveLength(3)
  })

  it('按需补译遇未知版本号:忽略不炸,快照不变', async () => {
    const db = openDb(':memory:').db
    const s = makeService(db)
    await s.get()

    const snap = await s.translateVersions(['9.9'])

    expect(snap.translatedVersions).toEqual(['3.0', '2.0'])
    expect(snap.markdown).toBe((await s.get()).markdown)
  })

  it('并发 refresh 与 translateVersions 互斥:不产生重复译制(Java synchronized 对应物)', async () => {
    const db = openDb(':memory:').db
    let calls = 0
    const s = makeService(db, { translate: async (b) => (calls++, TRANSLATOR(b)) })

    await Promise.all([s.refresh(), s.translateVersions(['1.0']), s.translateVersions(['2.0', '3.0']), s.refresh()])

    // 3 块各译恰好一次(recent=2 覆盖 3.0/2.0 + 补译 1.0)
    expect(calls).toBe(3)
  })
})

describe('extractContent(畸形响应 → null 触发降级,不抛)', () => {
  it('取 choices[0].message.content', () => {
    expect(extractContent({ choices: [{ message: { content: '译文' } }] })).toBe('译文')
  })

  it('choices 缺失 / 非数组 / 空数组 → null', () => {
    expect(extractContent(null)).toBeNull()
    expect(extractContent({})).toBeNull()
    expect(extractContent({ choices: 'nope' })).toBeNull()
    expect(extractContent({ choices: [] })).toBeNull()
  })

  it('content 非字符串 → null', () => {
    expect(extractContent({ choices: [{ message: { content: 42 } }] })).toBeNull()
    expect(extractContent({ choices: [{ message: null }] })).toBeNull()
  })
})

// ---- HTTP 契约(app.request() seam,api-contract.md §6)----

const httpDb = openDb(':memory:').db
const service = makeService(httpDb)
const app = createApp({ db: httpDb, changelog: service })

let cookie = ''
beforeAll(async () => {
  await bootstrap(httpDb, { username: 'admin', password: 'admin-pw' })
  const res = await app.request('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin-pw' }),
  })
  cookie = res.headers.getSetCookie()[0]!.split(';')[0]!
})

describe('GET /api/changelog', () => {
  it('未认证 401 空体', async () => {
    const res = await app.request('/api/changelog')
    expect(res.status).toBe(401)
    expect(await res.text()).toBe('')
  })

  it('200:markdown(已译块取译文)+ releasedAt + translatedVersions 形状照契约', async () => {
    const res = await app.request('/api/changelog', { headers: { cookie } })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      markdown: '# Changelog\n\n## 3.0\n- 三\n\n## 2.0\n- 二\n\n## 1.0\n- one\n',
      releasedAt: null, // npm 拉失败 → 显式 null(输出不省略),前端日期行降级「—」
      translatedVersions: ['3.0', '2.0'],
    })
  })
})

describe('POST /api/changelog/translate(按需补译,ADR-0017)', () => {
  it('未认证 401 空体', async () => {
    const res = await app.request('/api/changelog/translate', { method: 'POST' })
    expect(res.status).toBe(401)
    expect(await res.text()).toBe('')
  })

  it('补译指定版本,响应即重拼后的最新全文', async () => {
    const res = await app.request('/api/changelog/translate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ versions: ['1.0'] }),
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { markdown: string; translatedVersions: string[] }
    expect(json.markdown).toContain('一')
    expect(json.translatedVersions).toEqual(['3.0', '2.0', '1.0'])
  })

  it('缺 body / 缺 versions / null → 空表 no-op,不 500', async () => {
    for (const body of ['not-json', '{}', '{"versions":null}']) {
      const res = await app.request('/api/changelog/translate', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body,
      })
      expect(res.status).toBe(200)
      const json = (await res.json()) as { markdown: string }
      expect(json.markdown).toContain('三') // 既有快照照常返回
    }
  })
})

describe('冷启动兜底失败 → 500', () => {
  it('内存空且拉取失败:get 上抛经全局兜底 → {status:500, message:"服务器错误"}', async () => {
    const db = openDb(':memory:').db
    await bootstrap(db, { username: 'admin', password: 'admin-pw' })
    const coldApp = createApp({
      db,
      changelog: makeService(db, { fetchMarkdown: async () => { throw new Error('GitHub 不可达') } }),
    })
    const login = await coldApp.request('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin-pw' }),
    })
    const kv = login.headers.getSetCookie()[0]!.split(';')[0]!
    const res = await coldApp.request('/api/changelog', { headers: { cookie: kv } })
    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toEqual({ status: 500, message: '服务器错误' })
  })
})
