import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CHANGELOG_SOURCE, type ChangelogSourceId } from 'chrome-tab-shared'
import { createApp } from './app'
import { openDb, type Db } from './db'
import { bootstrap } from './seed'
import { expectError, setupApp } from './testUtils'
import {
  ChangelogService,
  composeReleasesMarkdown,
  prodChangelogDeps,
  refreshQuietly,
  splitBlocks,
  splitSegments,
  synthesizeVersionsMarkdown,
  type ChangelogDeps,
  type TranslatePhase,
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

function makeService(
  db: Db,
  deps: Partial<ChangelogDeps> = {},
  source: ChangelogSourceId = DEFAULT_CHANGELOG_SOURCE,
  translateRecent = 2,
) {
  const defaults: ChangelogDeps = {
    fetchMarkdown: async () => RAW,
    translate: async (b) => TRANSLATOR(b),
    fetchReleaseInfo: async () => null,
  }
  return new ChangelogService(db, source, { ...defaults, ...deps }, translateRecent)
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

describe('synthesizeVersionsMarkdown(无原文源版本流合成——ADR-0050 后无实例、类别保留)', () => {
  // npm time 表形态:含 created/modified 元键,prerelease(alpha)比稳定版多且新
  const CODEX_TIMES = {
    created: '2025-04-01T00:00:00.000Z',
    modified: '2026-08-23T00:00:00.000Z',
    '0.150.0-alpha.7': '2026-08-23T12:00:00.000Z',
    '0.149.0-alpha.4.3': '2026-08-23T10:00:00.000Z',
    '0.148.0': '2026-08-20T00:00:00.000Z',
    '0.149.1': '2026-08-24T00:28:28.000Z',
  }

  it('剔元键与 prerelease,按发布时间倒序,每版本一行 ## 空块', () => {
    expect(synthesizeVersionsMarkdown(CODEX_TIMES)).toBe('## 0.149.1\n## 0.148.0\n')
  })

  it('空表 → 空串(splitBlocks 得 0 块,前端空榜)', () => {
    expect(synthesizeVersionsMarkdown({})).toBe('')
  })
})

describe('composeReleasesMarkdown(GitHub Releases 正文合成,ADR-0050)', () => {
  // codex 线上形态:alpha body 一行占位,正式版完整小节(## 级,须降 ### 免被切版本块;
  // Changelog 节 = compare 链接 + 全量 PR 清单);API 按 created_at 序、published_at 有
  // 倒置(实测 18/100);杂项 tag(rusty-v8 crate bump)混在流里
  const RELEASES = [
    { tag_name: 'rust-v0.152.0-alpha.6', published_at: '2026-08-31T02:12:53Z', body: 'Release 0.152.0-alpha.6' },
    {
      tag_name: 'rust-v0.151.0',
      published_at: '2026-08-28T10:00:00Z',
      body: '## New Features\n- Added a grace period for MCP tools.\n\n## Changelog\n- Full Changelog: rust-v0.150.0...rust-v0.151.0\n- #41183 Account subagent tokens @copyberry\n\n## Bug Fixes\n- Fixed a crash.\n',
    },
    // published 晚于 0.151.0 但 API 序在后——不按 published_at 倒排就会错位
    { tag_name: 'rust-v0.151.5', published_at: '2026-08-30T09:00:00Z', body: null },
    // 实测杂项 tag:剥不出版本号,整条滤除
    { tag_name: 'rusty-v8-v150.4.0', published_at: '2026-07-29T00:00:00Z', body: null },
  ]

  it('published_at 倒排(不保 API 序);rust-v 剥离;杂项 tag 滤除;占位/空正文仅标题;## 降 ###;噪音小节整节剔除', () => {
    expect(composeReleasesMarkdown(RELEASES)).toBe(
      '## 0.152.0-alpha.6\n' +
        '## 0.151.5\n' +
        '## 0.151.0\n### New Features\n- Added a grace period for MCP tools.\n\n### Bug Fixes\n- Fixed a crash.\n',
    )
  })

  it('纯 prose 正文(无条目行)仅标题——空块判定与 parseChangelog 渲染语义对齐,占位措辞变化自愈', () => {
    expect(composeReleasesMarkdown([{ tag_name: 'v1.0.0', body: 'Misc polish.\nSecond line.' }])).toBe('## 1.0.0\n')
  })

  it('``` 围栏内的 ## 行原样(不降级);噪音小节后的 #### 标题恢复内容', () => {
    expect(
      composeReleasesMarkdown([
        {
          tag_name: 'v2.0.0',
          body: '## Setup\n```\n## not a heading\n```\n\n## Changelog\n- diff link\n\n#### Notes\n- real content\n',
        },
      ]),
    ).toBe('## 2.0.0\n### Setup\n```\n## not a heading\n```\n\n#### Notes\n- real content\n')
  })

  it('空表 → 空串', () => {
    expect(composeReleasesMarkdown([])).toBe('')
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
    const snapshotRow = await db
      .selectFrom('changelog_snapshots')
      .selectAll()
      .where('source', '=', DEFAULT_CHANGELOG_SOURCE)
      .executeTakeFirst()
    expect(snapshotRow?.raw_markdown).toBe(RAW)
    expect(snapshotRow?.released_at).toBeNull()
  })

  it('译文无尾换行:后续版本标题仍保持独立块', async () => {
    const db = openDb(':memory:').db
    const raw = '## 2.0\n- two\n\n## 1.0\n- one\n'
    const s = makeService(
      db,
      { fetchMarkdown: async () => raw, translate: async (block) => block.trimEnd() },
      DEFAULT_CHANGELOG_SOURCE,
      1,
    )

    expect(splitBlocks((await s.get()).markdown).blocks.map((b) => b.title)).toEqual(['2.0', '1.0'])
  })

  it('译制窗口跳过空块(合成源预发布占位块仅标题行,ADR-0050):取最近 N 个有内容块', async () => {
    const db = openDb(':memory:').db
    const seen: string[] = []
    const s = makeService(db, {
      fetchMarkdown: async () => '## 0.2.0-alpha.1\n## 0.1.0\n- one\n## 0.0.9\n- zero\n',
      translate: async (b) => (seen.push(b), b),
    })

    await s.get()

    expect(seen.map((b) => b.split('\n')[0])).toEqual(['## 0.1.0', '## 0.0.9'])
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

  it('重启恢复:loadFromDb 从快照表重建镜像(含 releaseTimes),零外呼零 LLM', async () => {
    const db = openDb(':memory:').db
    await makeService(db, {
      fetchReleaseInfo: async () => ({ latest: '3.0', times: { '3.0': '2026-08-30T00:00:00.000Z' } }),
    }).get() // 前一进程:建库(含发布时间)
    expect(
      await db
        .selectFrom('changelog_snapshots')
        .selectAll()
        .where('source', '=', DEFAULT_CHANGELOG_SOURCE)
        .executeTakeFirstOrThrow(),
    ).toBeDefined()

    let llmCalls = 0
    const restarted = makeService(db, {
      fetchMarkdown: async () => { throw new Error('重启后 GitHub 不可达') }, // 任何外呼即失败
      translate: async (b) => (llmCalls++, TRANSLATOR(b)),
    })
    await restarted.loadFromDb()

    expect((await restarted.get()).markdown).toContain('三')
    expect((await restarted.get()).markdown).toContain('二')
    expect((await restarted.get()).releaseTimes).toEqual({ '3.0': '2026-08-30T00:00:00.000Z' })
    expect((await restarted.get()).releasedAt).toBe('2026-08-30T00:00:00.000Z')
    expect(llmCalls).toBe(0)
  })

  it('releaseTimes 落库只增不减:新拉缺的版本保留旧值,发布信息失败(null)不清日期', async () => {
    const db = openDb(':memory:').db
    const s = makeService(db, {
      fetchReleaseInfo: async () => ({ latest: '3.0', times: { '3.0': '2026-08-01T00:00:00.000Z' } }),
    })
    await s.get() // 3.0 日期入库

    // 下轮发布信息失败(npm 分支吞错语义)/新拉只含 2.0:3.0 旧日期都不得丢
    const s2 = makeService(db, { fetchReleaseInfo: async () => null })
    await s2.refresh()
    expect((await s2.get()).releaseTimes).toEqual({ '3.0': '2026-08-01T00:00:00.000Z' })

    const s3 = makeService(db, {
      fetchReleaseInfo: async () => ({ latest: '2.0', times: { '2.0': '2026-08-30T00:00:00.000Z' } }),
    })
    await s3.refresh()
    expect((await s3.get()).releaseTimes).toEqual({
      '3.0': '2026-08-01T00:00:00.000Z',
      '2.0': '2026-08-30T00:00:00.000Z',
    })
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

  it('译制阶段 translatePhase:LLM 挂起中读为 translating(model+候选序),链空后回 idle', async () => {
    const db = openDb(':memory:').db
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const duringCall: TranslatePhase[] = []
    const s = makeService(db, {
      translate: async (b, onPhase) => {
        onPhase?.('m1', 1, 2)
        duringCall.push(s.translatePhase()) // onPhase 落字段后、LLM 返回前的中间态(读器返副本)
        onPhase?.('m2', 2, 2) // 换候选:since 不重置(elapsed = 总等待,候选变化由 model/attempt 表达)
        duringCall.push(s.translatePhase())
        await gate
        return TRANSLATOR(b)
      },
    })
    const pending = s.translateVersions(['3.0'])
    await new Promise((r) => setTimeout(r)) // 让链跑到挂起点

    expect(duringCall).toEqual([
      { status: 'translating', model: 'm1', attempt: 1, total: 2, since: expect.any(String) },
      { status: 'translating', model: 'm2', attempt: 2, total: 2, since: duringCall[0]!.since },
    ])

    release()
    await pending
    expect(s.translatePhase()).toEqual({ status: 'idle' }) // 排队推断 = 前端 isPending && idle
  })
})

describe('多源(ADR-0020:每源一 Service,快照按源分行;译文按块哈希跨源共享)', () => {
  const RAW_B = '# Matt\n\n## 3.0\n- three\n\n## 1.4\n- one\n' // 与 A 共享 3.0 块原文

  it('双源同库:快照各占一行互不覆盖,releasedAt 各自独立', async () => {
    const db = openDb(':memory:').db
    const a = makeService(db, {
      fetchReleaseInfo: async () => ({ latest: '3.0', times: { '3.0': '2026-08-01T00:00:00.000Z' } }),
    })
    const b = makeService(
      db,
      {
        fetchMarkdown: async () => RAW_B,
        fetchReleaseInfo: async () => ({ latest: '3.0', times: { '3.0': '2026-08-05T00:00:00.000Z' } }),
      },
      'matt-skills',
    )

    await a.get()
    await b.get()

    const rows = await db.selectFrom('changelog_snapshots').select(['source', 'released_at']).execute()
    expect(rows).toEqual([
      { source: 'claude-code', released_at: '2026-08-01T00:00:00.000Z' },
      { source: 'matt-skills', released_at: '2026-08-05T00:00:00.000Z' },
    ])
    expect((await a.get()).markdown).toContain('## 1.0') // B 的刷新不冲掉 A
    expect((await b.get()).markdown).toContain('## 1.4')
  })

  it('同原文块两源零重复译制:块哈希跨源命中,译文表无需源维度', async () => {
    const db = openDb(':memory:').db
    const translated: string[] = []
    const spy = async (b: string) => (translated.push(b), TRANSLATOR(b))
    const a = makeService(db, { translate: spy })
    await a.get() // 译 A 的 3.0/2.0(共享块 = 3.0)

    const b = makeService(db, { fetchMarkdown: async () => RAW_B, translate: spy }, 'matt-skills')
    await b.get() // 3.0 哈希命中;窗口(recent=2)内只有 1.4 缺失

    expect(translated.filter((x) => x.includes('3.0'))).toHaveLength(1) // 3.0 只被译过一次
    expect((await b.get()).markdown).toContain('- 三') // 直接复用 A 的译文
  })

  it('同版本号、不同原文:各译各的,互不串台(哈希含全块原文)', async () => {
    const db = openDb(':memory:').db
    const zh: Array<[string, string]> = [
      ['alpha', '甲'],
      ['beta', '乙'],
    ]
    const translate = async (b: string) => {
      for (const [en, cn] of zh) if (b.includes(en)) return b.replaceAll(en, cn)
      throw new Error(`未知块: ${b}`)
    }
    const a = makeService(db, {
      fetchMarkdown: async () => '# A\n\n## 1.2.3\n- alpha fix\n',
      translate,
    })
    const b = makeService(db, { fetchMarkdown: async () => '# B\n\n## 1.2.3\n- beta fix\n', translate }, 'matt-skills')

    await a.get()
    await b.get()

    // 两行译文,各归各源;B 的 1.2.3 绝不显示 A 的译文
    expect(await db.selectFrom('changelog_translations').selectAll().execute()).toHaveLength(2)
    expect((await a.get()).markdown).toContain('甲')
    expect((await a.get()).markdown).not.toContain('乙')
    expect((await b.get()).markdown).toContain('乙')
    expect((await b.get()).markdown).not.toContain('甲')
  })

  it('loadFromDb 只恢复本源行', async () => {
    const db = openDb(':memory:').db
    await makeService(db).get()
    await makeService(db, { fetchMarkdown: async () => RAW_B }, 'matt-skills').get()

    const b = makeService(
      db,
      { fetchMarkdown: async () => { throw new Error('任何外呼即失败') } },
      'matt-skills',
    )
    await b.loadFromDb()
    expect((await b.get()).markdown).toContain('## 1.4') // 恢复的是 B 自己的快照
  })
})

// 无原文源(两地址皆缺省,现无实例,ADR-0050 类别保留):版本流 npm 合成、零译制
describe('无原文源源的 Service 构造(source 参数借用 codex 行键)', () => {
  const CODEX_TIMES = {
    created: '2025-04-01T00:00:00.000Z',
    '0.150.0-alpha.7': '2026-08-23T12:00:00.000Z',
    '0.148.0': '2026-08-20T00:00:00.000Z',
    '0.149.1': '2026-08-24T00:28:28.000Z',
  }

  it('translateRecent=0:refresh 全程零 LLM 调用,合成版本行照常入快照', async () => {
    const db = openDb(':memory:').db
    let calls = 0
    const s = new ChangelogService(
      db,
      'codex',
      {
        fetchMarkdown: async () => synthesizeVersionsMarkdown(CODEX_TIMES),
        translate: async (b) => (calls++, TRANSLATOR(b)),
        fetchReleaseInfo: async () => ({ latest: '0.149.1', times: CODEX_TIMES }),
      },
      0, // index.ts 对无原文源(hasChangelogRaw=false,现无实例)的同款构造
    )

    const snap = await s.get()

    expect(snap.markdown).toBe('## 0.149.1\n## 0.148.0\n')
    expect(snap.translatedVersions).toEqual([])
    expect(snap.releaseTimes).toEqual(CODEX_TIMES)
    expect(calls).toBe(0)
    const row = await db
      .selectFrom('changelog_snapshots')
      .selectAll()
      .where('source', '=', 'codex')
      .executeTakeFirst()
    expect(row?.raw_markdown).toBe('## 0.149.1\n## 0.148.0\n')
    expect(row?.released_at).toBe('2026-08-24T00:28:28.000Z')
  })

  it('重启恢复:合成快照从 loadFromDb 重建,块标题即版本行', async () => {
    const db = openDb(':memory:').db
    await new ChangelogService(
      db,
      'codex',
      {
        fetchMarkdown: async () => synthesizeVersionsMarkdown(CODEX_TIMES),
        translate: async () => null,
        fetchReleaseInfo: async () => null,
      },
      0,
    ).get()

    const restarted = new ChangelogService(
      db,
      'codex',
      {
        fetchMarkdown: async () => { throw new Error('任何外呼即失败') },
        translate: async () => { throw new Error('任何 LLM 即失败') },
        fetchReleaseInfo: async () => null,
      },
      0,
    )
    await restarted.loadFromDb()

    const snap = await restarted.get()
    expect(snap.blocks.blocks.map((b) => b.title)).toEqual(['0.149.1', '0.148.0'])
    expect(snap.markdown).toContain('## 0.149.1')
  })
})

// ---- 模型候选链(prodChangelogDeps.translate 真链路,mock globalThis.fetch)----

describe('translate 候选链(候选失效=403/404/429/5xx/no_available_channel/超时/200空content 换下一个,401等直接抛)', () => {
  const realFetch = globalThis.fetch
  // 闸门住 callModel(ADR-0037):真链路用例过闸,注入 1ms 跳过等待;节流行为本身单测见末尾用例
  beforeEach(() => {
    process.env.LLM_MIN_REQUEST_INTERVAL_MS = '1'
  })
  afterEach(() => {
    globalThis.fetch = realFetch
    delete process.env.AIHUBMIX_API_KEY
    delete process.env.CHANGELOG_LLM_MODEL
    delete process.env.LLM_MIN_REQUEST_INTERVAL_MS
  })

  /** 依次返回 seq 响应(超出取末个),记录每次请求的 model 字段顺序;timeout: true 模拟超时拒绝。 */
  function mockFetchSeq(seq: Array<{ status?: number; body?: unknown; timeout?: boolean }>): string[] {
    const models: string[] = []
    let i = 0
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      models.push(JSON.parse(String(init?.body)).model)
      const s = seq[Math.min(i++, seq.length - 1)]!
      if (s.timeout) throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
      return new Response(JSON.stringify(s.body), { status: s.status ?? 200 })
    }) as typeof fetch
    return models
  }

  const OK = { status: 200, body: { choices: [{ message: { content: '译文' } }] } }
  const NO_CHANNEL = { status: 400, body: { error: { code: 'no_available_channel' } } }

  it('no_available_channel → 换下一候选直到成功,请求按候选序', async () => {
    process.env.AIHUBMIX_API_KEY = 'k'
    process.env.CHANGELOG_LLM_MODEL = 'm1,m2,m3'
    const models = mockFetchSeq([NO_CHANNEL, NO_CHANNEL, OK])
    await expect(prodChangelogDeps().translate('块')).resolves.toBe('译文')
    expect(models).toEqual(['m1', 'm2', 'm3'])
  })

  it('403(模型被禁,如线上 coding-kimi-k3-free)同样换下一候选', async () => {
    process.env.AIHUBMIX_API_KEY = 'k'
    process.env.CHANGELOG_LLM_MODEL = 'm1,m2'
    const models = mockFetchSeq([{ status: 403, body: {} }, OK])
    await expect(prodChangelogDeps().translate('块')).resolves.toBe('译文')
    expect(models).toEqual(['m1', 'm2'])
  })

  it('超时(TimeoutError)同样换下一候选:挂死模型不再拖满单模型上限(300s→60s 语义配套)', async () => {
    process.env.AIHUBMIX_API_KEY = 'k'
    process.env.CHANGELOG_LLM_MODEL = 'm1,m2'
    const models = mockFetchSeq([{ timeout: true }, OK])
    await expect(prodChangelogDeps().translate('块')).resolves.toBe('译文')
    expect(models).toEqual(['m1', 'm2'])
  })

  it('200 但响应无 content(free 模型空补全/畸形)→ 换下一候选,不整体静默失败', async () => {
    process.env.AIHUBMIX_API_KEY = 'k'
    process.env.CHANGELOG_LLM_MODEL = 'm1,m2'
    const models = mockFetchSeq([{ status: 200, body: { choices: [{ message: { content: null } }] } }, OK])
    await expect(prodChangelogDeps().translate('块')).resolves.toBe('译文')
    expect(models).toEqual(['m1', 'm2'])
  })

  it('200 但 content 为空串 → 同判候选失效:空译文入哈希表会让该版本永久渲染空行', async () => {
    process.env.AIHUBMIX_API_KEY = 'k'
    process.env.CHANGELOG_LLM_MODEL = 'm1,m2'
    const models = mockFetchSeq([{ status: 200, body: { choices: [{ message: { content: '' } }] } }, OK])
    await expect(prodChangelogDeps().translate('块')).resolves.toBe('译文')
    expect(models).toEqual(['m1', 'm2'])
  })

  it('5xx(网关/上游错误)→ 换下一候选', async () => {
    process.env.AIHUBMIX_API_KEY = 'k'
    process.env.CHANGELOG_LLM_MODEL = 'm1,m2'
    const models = mockFetchSeq([{ status: 502, body: 'bad gateway' }, OK])
    await expect(prodChangelogDeps().translate('块')).resolves.toBe('译文')
    expect(models).toEqual(['m1', 'm2'])
  })

  it('401(key 无效)换模型无益:直接抛,不再请求', async () => {
    process.env.AIHUBMIX_API_KEY = 'k'
    process.env.CHANGELOG_LLM_MODEL = 'm1,m2'
    const models = mockFetchSeq([{ status: 401, body: { error: { code: 'invalid_api_key' } } }])
    await expect(prodChangelogDeps().translate('块')).rejects.toThrow('HTTP 401')
    expect(models).toEqual(['m1'])
  })

  it('全链候选失效:抛末次错误(调用方 warn 降级英文)', async () => {
    process.env.AIHUBMIX_API_KEY = 'k'
    process.env.CHANGELOG_LLM_MODEL = 'm1,m2'
    const models = mockFetchSeq([NO_CHANNEL, NO_CHANNEL])
    await expect(prodChangelogDeps().translate('块')).rejects.toThrow('HTTP 400')
    expect(models).toEqual(['m1', 'm2'])
  })

  it('Key 缺失:返回 null(Service 层据此透传英文原文)', async () => {
    expect(prodChangelogDeps().translate('块')).resolves.toBeNull()
  })

  it('onPhase 回调:每次换候选前上报 (model, attempt, total),Service 据此暴露阶段', async () => {
    process.env.AIHUBMIX_API_KEY = 'k'
    process.env.CHANGELOG_LLM_MODEL = 'm1,m2'
    const events: Array<[string, number, number]> = []
    mockFetchSeq([NO_CHANNEL, OK])
    await prodChangelogDeps().translate('块', (model, attempt, total) => events.push([model, attempt, total]))
    expect(events).toEqual([
      ['m1', 1, 2],
      ['m2', 2, 2],
    ])
  })

  it('节流闸门:换候选的连续两次请求至少间隔 LLM_MIN_REQUEST_INTERVAL_MS(闸门住 callModel,三域共享)', async () => {
    process.env.AIHUBMIX_API_KEY = 'k'
    process.env.CHANGELOG_LLM_MODEL = 'm1,m2'
    process.env.LLM_MIN_REQUEST_INTERVAL_MS = '80'
    const times: number[] = []
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      times.push(Date.now())
      const model = JSON.parse(String(init?.body)).model
      if (model === 'm1') return new Response(JSON.stringify(NO_CHANNEL.body), { status: NO_CHANNEL.status })
      return new Response(JSON.stringify(OK.body), { status: 200 })
    }) as typeof fetch
    await expect(prodChangelogDeps().translate('块')).resolves.toBe('译文')
    expect(times.length).toBe(2)
    // 闸门间隔按「放行时刻」计,fetch 时刻差带 ±几 ms 微任务噪声,80 全额会偶发 79——
    // 无闸裸奔实测 0~3ms,50 居中判别(translate.test.ts 闸门用例同款)
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(50)
  })
})

// ---- 分段译制(2026-08-26:2.1.246 块 9.2k 字符,非流式单请求生成 >60s,7 候选全超时)----

describe('splitSegments(段=行边界,单请求输出压小,稳离 60s 超时)', () => {
  it('不超过上限整块一段,原样返回', () => {
    expect(splitSegments('## 1.0\n- x\n')).toEqual(['## 1.0\n- x\n'])
  })

  it('超上限按行切段:每段 ≤上限、行不撕开、标题行留首段', () => {
    const line = `- ${'a'.repeat(98)}\n` // 101 字符/行
    const block = `## 9.9\n${line.repeat(20)}` // 7 + 2020 = 2027 > 2000
    const segs = splitSegments(block)
    expect(segs.length).toBe(2)
    expect(segs[0]).toBe(`## 9.9\n${line.repeat(19)}`)
    expect(segs[1]).toBe(line)
    expect(segs.every((s) => s.length <= 2000)).toBe(true)
  })

  it('单行自身超上限:独占一段不撕行(前段先按上限封住)', () => {
    const huge = `- ${'a'.repeat(3000)}\n`
    expect(splitSegments(`## 1.0\n${huge}- small\n`)).toEqual(['## 1.0\n', huge, '- small\n'])
  })
})

describe('translate 分段(大块逐段请求,段失败换候选只重试该段)', () => {
  const realFetch = globalThis.fetch
  // 闸门住 callModel(ADR-0037):分段真链路多次过闸,注入 1ms 跳过等待
  beforeEach(() => {
    process.env.LLM_MIN_REQUEST_INTERVAL_MS = '1'
  })
  afterEach(() => {
    globalThis.fetch = realFetch
    delete process.env.AIHUBMIX_API_KEY
    delete process.env.CHANGELOG_LLM_MODEL
    delete process.env.LLM_MIN_REQUEST_INTERVAL_MS
  })

  /** mockFetchSeq 的分段版:另记录每次请求的 user content(断言段大小与内容)。 */
  function mockFetchSeqLog(seq: Array<{ status?: number; body?: unknown; timeout?: boolean }>): {
    models: string[]
    users: string[]
  } {
    const models: string[] = []
    const users: string[] = []
    let i = 0
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      models.push(body.model)
      users.push(body.messages[1].content)
      const s = seq[Math.min(i++, seq.length - 1)]!
      if (s.timeout) throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
      return new Response(JSON.stringify(s.body), { status: s.status ?? 200 })
    }) as typeof fetch
    return { models, users }
  }

  const NO_CHANNEL = { status: 400, body: { error: { code: 'no_available_channel' } } }
  const line = (tag: string) => `- ${'a'.repeat(96)} ${tag}\n` // 102 字符/行
  const ok = (content: string) => ({ status: 200, body: { choices: [{ message: { content } }] } })

  /** 21 行 × 102 字符 + 标题 = 2149 > 2000 → 恰切 2 段;段内容断言委托 splitSegments 自身。 */
  const bigBlock = `## 9.9\n${Array.from({ length: 21 }, (_, i) => line(`s${i}`)).join('')}`
  const segs = splitSegments(bigBlock)

  it('大块 → 多次请求,每次 user = splitSegments 的段,译文按段序拼接(段间补换行防粘行)', async () => {
    process.env.AIHUBMIX_API_KEY = 'k'
    process.env.CHANGELOG_LLM_MODEL = 'm1'
    const { models, users } = mockFetchSeqLog([ok('段一译文'), ok('段二译文')])
    await expect(prodChangelogDeps().translate(bigBlock)).resolves.toBe('段一译文\n段二译文')
    expect(models).toEqual(['m1', 'm1'])
    expect(users).toEqual(segs)
  })

  it('段 2 首候选 no_available_channel → 换候选只重试该段,段 1 译文不重译', async () => {
    process.env.AIHUBMIX_API_KEY = 'k'
    process.env.CHANGELOG_LLM_MODEL = 'm1,m2'
    const { models } = mockFetchSeqLog([ok('段一'), NO_CHANNEL, ok('段二')])
    await expect(prodChangelogDeps().translate(bigBlock)).resolves.toBe('段一\n段二')
    expect(models).toEqual(['m1', 'm1', 'm2'])
  })

  it('某段全链候选失效 → 整块 reject(Service 层 warn 降级英文,语义同前)', async () => {
    process.env.AIHUBMIX_API_KEY = 'k'
    process.env.CHANGELOG_LLM_MODEL = 'm1,m2'
    const { models } = mockFetchSeqLog([ok('段一'), NO_CHANNEL, NO_CHANNEL])
    await expect(prodChangelogDeps().translate(bigBlock)).rejects.toThrow('HTTP 400')
    expect(models).toEqual(['m1', 'm1', 'm2'])
  })
})

describe('codex prodChangelogDeps:fetchMarkdown/fetchReleaseInfo 走 GitHub Releases 合成(ADR-0050)', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
    delete process.env.GITHUB_TOKEN
  })

  const RELEASES = [
    { tag_name: 'rust-v0.152.0-alpha.6', published_at: '2026-08-31T02:12:53Z', body: 'Release 0.152.0-alpha.6' },
    { tag_name: 'rust-v0.151.0', published_at: '2026-08-28T10:00:00Z', body: '## New Features\n- MCP grace period.\n' },
  ]

  it('同一 refresh 周期单次抓取两用(~26MB 响应不拉两次):fetchMarkdown 合成 → fetchReleaseInfo 复用;Bearer 打到 codex releases 端点;latest 稳定轴', async () => {
    process.env.GITHUB_TOKEN = 't0'
    let calls = 0
    globalThis.fetch = vi.fn(async (url: unknown, init?: unknown) => {
      calls++
      expect(String(url)).toBe('https://api.github.com/repos/openai/codex/releases?per_page=100')
      expect((init as { headers?: Record<string, string> }).headers).toEqual({ Authorization: 'Bearer t0' })
      return new Response(JSON.stringify(RELEASES))
    }) as typeof fetch
    const deps = prodChangelogDeps('codex')

    await expect(deps.fetchMarkdown()).resolves.toBe(
      '## 0.152.0-alpha.6\n## 0.151.0\n### New Features\n- MCP grace period.\n',
    )
    await expect(deps.fetchReleaseInfo()).resolves.toEqual({
      latest: '0.151.0', // 稳定轴(与 npm dist-tags.latest 同),不取全量最新的 alpha
      times: { '0.152.0-alpha.6': '2026-08-31T02:12:53Z', '0.151.0': '2026-08-28T10:00:00Z' },
    })
    expect(calls).toBe(1)
  })

  it('API 不可达:两者均上抛(GitHub 主链不吞错——假成功会钉死空表,refreshQuietly 重试的前提)', async () => {
    globalThis.fetch = vi.fn(async () => new Response('nope', { status: 403 })) as typeof fetch
    const deps = prodChangelogDeps('codex')
    await expect(deps.fetchMarkdown()).rejects.toThrow('HTTP 403')
    await expect(deps.fetchReleaseInfo()).rejects.toThrow('HTTP 403')
  })
})

describe('Matt Skills prodChangelogDeps:发布日期走 GitHub Releases', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('v 前缀标签映射为 CHANGELOG 版本号', async () => {
    globalThis.fetch = vi.fn(async (url: unknown) => {
      expect(String(url)).toBe('https://api.github.com/repos/mattpocock/skills/releases?per_page=100')
      return new Response(JSON.stringify([
        { tag_name: 'v1.2.3', published_at: '2026-08-06T14:05:28Z' },
        { tag_name: 'v1.2.2', published_at: '2026-08-05T18:10:19Z' },
      ]))
    }) as typeof fetch

    await expect(prodChangelogDeps('matt-skills').fetchReleaseInfo()).resolves.toEqual({
      latest: '1.2.3',
      times: {
        '1.2.3': '2026-08-06T14:05:28Z',
        '1.2.2': '2026-08-05T18:10:19Z',
      },
    })
  })
})

// ---- HTTP 契约(app.request() seam,api-contract.md §6)----

const httpDb = openDb(':memory:').db
const service = makeService(httpDb)
const app = createApp({
  db: httpDb,
  changelog: { 'claude-code': service, 'matt-skills': service, codex: makeService(httpDb, {}, 'codex') },
})

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
      releaseTimes: {},
      translatedVersions: ['3.0', '2.0'],
    })
  })
})

describe('GET /api/changelog ?source 分流(ADR-0020)', () => {
  const db2 = openDb(':memory:').db
  const svcB = makeService(
    db2,
    { fetchMarkdown: async () => '# Matt\n\n## 1.5\n- one\n' },
    'matt-skills',
  )
  const app2 = createApp({
    db: db2,
    changelog: { 'claude-code': makeService(db2), 'matt-skills': svcB, codex: makeService(db2, {}, 'codex') },
  })
  let cookie2 = ''
  beforeAll(async () => {
    await bootstrap(db2, { username: 'admin', password: 'admin-pw' })
    const res = await app2.request('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin-pw' }),
    })
    cookie2 = res.headers.getSetCookie()[0]!.split(';')[0]!
  })

  it('?source=matt-skills → 该源快照;未知/缺省 → 回落默认源', async () => {
    const resB = await app2.request('/api/changelog?source=matt-skills', { headers: { cookie: cookie2 } })
    expect(resB.status).toBe(200)
    expect(((await resB.json()) as { markdown: string }).markdown).toContain('## 1.5')

    for (const q of ['', '?source=bogus']) {
      const res = await app2.request(`/api/changelog${q}`, { headers: { cookie: cookie2 } })
      expect(res.status).toBe(200)
      expect(((await res.json()) as { markdown: string }).markdown).toContain('## 3.0') // A 的 fixture
    }
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

describe('GET /api/changelog/translate/status(译制阶段:排队/换候选可观察)', () => {
  it('未认证 401 空体', async () => {
    const res = await app.request('/api/changelog/translate/status')
    expect(res.status).toBe(401)
    expect(await res.text()).toBe('')
  })

  it('链空 idle;LLM 挂起中 translating(含 model/候选序),译毕回 idle', async () => {
    const { db } = openDb(':memory:')
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const svc = makeService(db, {
      translate: async (b, onPhase) => {
        onPhase?.('m1', 1, 2)
        await gate
        return TRANSLATOR(b)
      },
    })
    const app2 = createApp({
      db,
      changelog: { 'claude-code': svc, 'matt-skills': makeService(db), codex: makeService(db, {}, 'codex') },
    })
    await bootstrap(db, { username: 'admin', password: 'admin-pw' })
    const login = await app2.request('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin-pw' }),
    })
    const cookie2 = login.headers.getSetCookie()[0]!.split(';')[0]!

    const pending = svc.translateVersions(['3.0'])
    await new Promise((r) => setTimeout(r)) // 让链跑到挂起点
    const mid = await app2.request('/api/changelog/translate/status', { headers: { cookie: cookie2 } })
    expect(await mid.json()).toMatchObject({ status: 'translating', model: 'm1', attempt: 1, total: 2 })

    release()
    await pending
    const after = await app2.request('/api/changelog/translate/status', { headers: { cookie: cookie2 } })
    expect(await after.json()).toEqual({ status: 'idle' })
  })
})

describe('releasedAt 成功路径(npm dist-tags.latest time 条目透传)', () => {
  it('200:ISO 串原样下发(非 null),失败路径才显式 null', async () => {
    const db = openDb(':memory:').db
    const { req, login } = await setupApp(
      makeService(db, {
        fetchReleaseInfo: async () => ({ latest: '3.0', times: { '3.0': '2026-08-01T00:00:00.000Z' } }),
      }),
    )
    const res = await req('GET', '/api/changelog', { cookie: await login() })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { releasedAt: string | null }
    expect(json.releasedAt).toBe('2026-08-01T00:00:00.000Z')
  })
})

describe('releaseTimes(每版本 npm 发布时间:大 tile 版本榜单一行一版本带时间)', () => {
  it('200:time 全表映射原样下发,releasedAt = times[latest]', async () => {
    const db = openDb(':memory:').db
    const times = { '3.0': '2026-08-01T00:00:00.000Z', '2.0': '2026-07-01T00:00:00.000Z' }
    const { req, login } = await setupApp(
      makeService(db, { fetchReleaseInfo: async () => ({ latest: '3.0', times }) }),
    )
    const res = await req('GET', '/api/changelog', { cookie: await login() })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { releasedAt: string | null; releaseTimes: Record<string, string> }
    expect(json.releasedAt).toBe('2026-08-01T00:00:00.000Z')
    expect(json.releaseTimes).toEqual(times)
  })

  it('npm 失败:null 降级 → 空表 + releasedAt null,主链路照常 200', async () => {
    const db = openDb(':memory:').db
    const { req, login } = await setupApp(makeService(db, { fetchReleaseInfo: async () => null }))
    const res = await req('GET', '/api/changelog', { cookie: await login() })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { releasedAt: string | null; releaseTimes: Record<string, string> }
    expect(json.releasedAt).toBeNull()
    expect(json.releaseTimes).toEqual({})
  })

  it('time[latest] 为空串:releasedAt 显式 null(不透 ""),times 原样下发', async () => {
    const db = openDb(':memory:').db
    const { req, login } = await setupApp(
      makeService(db, { fetchReleaseInfo: async () => ({ latest: '3.0', times: { '3.0': '' } }) }),
    )
    const res = await req('GET', '/api/changelog', { cookie: await login() })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { releasedAt: string | null; releaseTimes: Record<string, string> }
    expect(json.releasedAt).toBeNull()
    expect(json.releaseTimes).toEqual({ '3.0': '' })
  })
})

describe('冷启动兜底失败 → 500', () => {
  it('内存空且拉取失败:get 上抛经全局兜底 → {status:500, message:"服务器错误"}', async () => {
    const db = openDb(':memory:').db
    const { req, login } = await setupApp(makeService(db, { fetchMarkdown: async () => { throw new Error('GitHub 不可达') } }))
    await expectError(await req('GET', '/api/changelog', { cookie: await login() }), 500, '服务器错误')
  })
})

describe('refreshQuietly(刷新失败重试——2026-08-31 线上:启动预热恰逢 mihomo 抖动超时,空 releaseTimes 被钉死到下个 6h cron 窗,版本行日期整列消失)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('失败 warn 后按 retryMs 重试,成功即停;重试成功后 releaseTimes 补齐(日期列恢复)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    let calls = 0
    const db = openDb(':memory:').db
    // 对齐线上时间线:call1 基线刷新发布信息失败(空表,症状起点);call2 抖动期
    // markdown 拉取超时(06:33 形态,refresh 上抛);call3 网络恢复,发布信息一并拿到
    const svc = makeService(db, {
      fetchMarkdown: async () => {
        calls++
        if (calls === 2) throw new Error('网络抖动')
        return RAW
      },
      fetchReleaseInfo: async () => (calls < 3 ? null : { latest: '3.0', times: { '3.0': '2026-08-31T00:00:00.000Z' } }),
    })
    await svc.refresh()
    expect((await svc.get()).releaseTimes).toEqual({}) // 基线:发布信息失败 → 空表,前端行级降级不显示日期
    refreshQuietly(svc, 60_000)
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toBe(2)
    expect(console.warn).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(calls).toBe(3) // 网络恢复,重试成功
    expect((await svc.get()).releaseTimes).toEqual({ '3.0': '2026-08-31T00:00:00.000Z' }) // 日期列恢复
    await vi.advanceTimersByTimeAsync(600_000)
    expect(calls).toBe(3) // 成功即停,不再排重试
  })
})

describe('fetchReleaseInfo GitHub 认证(GITHUB_TOKEN 可选:未认证限额 60 req/h 按出口 IP 计,机场共享出口常态被别人耗光 → 403 remaining:0,matt 发布日期因此消失;2026-08-31)', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
    delete process.env.GITHUB_TOKEN
  })

  /** mock 单次 GitHub releases 200,返回捕获的请求 headers 与解析结果。 */
  const mockGithub = async () => {
    let init: RequestInit | undefined
    globalThis.fetch = vi.fn(async (_u: unknown, i?: RequestInit) => {
      init = i
      return new Response(JSON.stringify([{ tag_name: 'v1.2.3', published_at: '2026-08-01T00:00:00Z' }]), {
        status: 200,
      })
    }) as typeof fetch
    const info = await prodChangelogDeps('matt-skills').fetchReleaseInfo()
    return { headers: new Headers(init?.headers), info }
  }

  it('未配 token:无 Authorization 头,tag 去 v 前缀(行为不变)', async () => {
    const { headers, info } = await mockGithub()
    expect(headers.get('authorization')).toBeNull()
    expect(info).toEqual({ latest: '1.2.3', times: { '1.2.3': '2026-08-01T00:00:00Z' } })
  })

  it('配了 token:GitHub releases 请求带 Bearer 头(限额 60→5000/h)', async () => {
    process.env.GITHUB_TOKEN = 'ghp_test'
    const { headers, info } = await mockGithub()
    expect(headers.get('authorization')).toBe('Bearer ghp_test')
    expect(info?.latest).toBe('1.2.3')
  })
})
