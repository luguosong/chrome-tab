import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CHANGELOG_SOURCE, type ChangelogSourceId } from 'chrome-tab-shared'
import { createApp } from './app'
import { openDb, type Db } from './db'
import { bootstrap } from './seed'
import { expectError, setupApp } from './testUtils'
import {
  extractContent,
  ChangelogService,
  modelCandidates,
  prodChangelogDeps,
  splitBlocks,
  synthesizeVersionsMarkdown,
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

describe('synthesizeVersionsMarkdown(无原文源版本流合成,如 codex)', () => {
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

describe('无原文源(codex:changelogUrl 缺省,版本流 npm 合成、零译制)', () => {
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
      0, // index.ts 对无原文源的同款构造
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

// ---- 模型候选链(prodChangelogDeps.translate 真链路,mock globalThis.fetch)----

describe('modelCandidates(free 优先,CHANGELOG_LLM_MODEL 逗号分隔覆盖)', () => {
  it('默认:三 free + coding-glm-5.2 兜底', () => {
    expect(modelCandidates()).toEqual([
      'coding-glm-5.1-free',
      'coding-kimi-k3-free',
      'gemini-3.6-flash-free',
      'coding-glm-5.2',
    ])
  })

  it('env 覆盖:逗号分隔 + trim,空段过滤;空串回默认(compose 缺省键注入的是 "")', () => {
    expect(modelCandidates({ CHANGELOG_LLM_MODEL: ' a , b,,' } as NodeJS.ProcessEnv)).toEqual(['a', 'b'])
    expect(modelCandidates({ CHANGELOG_LLM_MODEL: '' } as NodeJS.ProcessEnv)).toEqual(modelCandidates())
  })
})

describe('translate 候选链(候选失效=403/404/no_available_channel 换下一个,其余直接抛)', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
    delete process.env.AIHUBMIX_API_KEY
    delete process.env.CHANGELOG_LLM_MODEL
  })

  /** 依次返回 seq 响应(超出取末个),记录每次请求的 model 字段顺序。 */
  function mockFetchSeq(seq: Array<{ status: number; body: unknown }>): string[] {
    const models: string[] = []
    let i = 0
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      models.push(JSON.parse(String(init?.body)).model)
      const s = seq[Math.min(i++, seq.length - 1)]!
      return new Response(JSON.stringify(s.body), { status: s.status })
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
})

describe('无原文源 prodChangelogDeps(codex):fetchMarkdown 走 npm 合成', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('packument time 表 → 合成 markdown;npm 不可达 → 上抛(refresh 沿用旧快照/冷启动 500 同 CHANGELOG.md 拉取失败)', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            'dist-tags': { latest: '0.149.1' },
            time: { created: '2025-04-01T00:00:00.000Z', '0.150.0-alpha.7': '2026-08-23T12:00:00.000Z', '0.148.0': '2026-08-20T00:00:00.000Z', '0.149.1': '2026-08-24T00:28:28.000Z' },
          }),
          { status: 200 },
        ),
    ) as typeof fetch
    await expect(prodChangelogDeps('codex').fetchMarkdown()).resolves.toBe('## 0.149.1\n## 0.148.0\n')

    globalThis.fetch = vi.fn(async () => new Response('nope', { status: 503 })) as typeof fetch
    await expect(prodChangelogDeps('codex').fetchMarkdown()).rejects.toThrow('npm packument')
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
