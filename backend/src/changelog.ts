import { createHash } from 'node:crypto'
import { schedule } from 'node-cron'
import { Hono, type Context } from 'hono'
import {
  DEFAULT_CHANGELOG_SOURCE,
  getChangelogSource,
  type ChangelogSourceId,
} from 'chrome-tab-shared'
import type { Db } from './db'
import type { AuthEnv } from './auth'

/**
 * 更新日志译制代理(ADR-0005/0016/0017,语义照搬 Java changelog 模块;多源化见 ADR-0020)。
 * 请求路径纯读内存快照(原子换新,零外呼零 LLM);node-cron 每 6h 预取刷新;
 * 启动先 loadFromDb 从快照表恢复(秒级可服务)再异步预热,失败沿用旧快照(最多旧 6h)。
 * 译文按版本块原文 SHA-256 主键持久化,一版终身只译一次;增量检测纯算法零 token;
 * 块哈希与源无关——同原文块跨源共享译文,译文表无需源维度;
 * 译制失败记 warn 保持英文、下轮重试;refresh 与 translateVersions 互斥防并发重复译制。
 * 每源一个 Service 实例(source 参数),快照表 changelog_snapshots 按源一行。
 */

// ---- 切片器(Java ChangelogSlicer)----

export interface Block {
  /** 版本号(如 2.0.14),规则与前端 parseChangelog 的 h[1].trim() 对齐 */
  title: string
  /** 含标题行的整块原文——块边界即哈希边界,错一字符即失配 */
  raw: string
}

export interface Blocks {
  prefix: string
  blocks: Block[]
}

/** 行首 `## `(两井号+空白)起一个版本块;`### ` 三级标题归入所属版本块。 */
export function splitBlocks(markdown: string): Blocks {
  const starts: number[] = []
  for (const m of markdown.matchAll(/^##\s/gm)) starts.push(m.index)
  if (starts.length === 0) return { prefix: markdown, blocks: [] } // 无版本标题:整篇作前缀
  const blocks: Block[] = []
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1]! : markdown.length
    const raw = markdown.slice(starts[i], end)
    const heading = raw.split('\n', 1)[0]!
    blocks.push({ title: heading.replace(/^##\s*/, '').trim(), raw })
  }
  return { prefix: markdown.slice(0, starts[0]), blocks }
}

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

// ---- 编排(Java ChangelogService)----

/** IO 协作器,测试注入假实现(Java 的函数式接口对应物)。 */
export interface ChangelogDeps {
  /** 拉 CHANGELOG.md 原文。抛错 → 兜底路径 500,前端走「刷新失败/重试」。 */
  fetchMarkdown: () => Promise<string>
  /** 译制单个版本块。返回 null = 拒绝(如未配置 Key);抛错 = 译制失败。 */
  translate: (versionBlock: string) => Promise<string | null>
  /** 最新版 npm 发布时间(ISO)。失败由实现方吞掉返回 null,不阻塞主链路。 */
  fetchReleasedAt: () => Promise<string | null>
}

export interface Snapshot {
  markdown: string
  releasedAt: string | null
  translatedVersions: string[]
  /** 供按需补译免重切 */
  blocks: Blocks
}

const nowIso = () => new Date().toISOString()

export class ChangelogService {
  private memory: Snapshot | null = null
  /** Java synchronized 的 async 对应物:refresh/translateVersions 排到同一条链上串行执行 */
  private tail: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly db: Db,
    /** 本实例绑定的外源(scheduler 日志用;取数 URL 在 deps 里已按源定型)。 */
    readonly source: ChangelogSourceId,
    private readonly deps: ChangelogDeps,
    private readonly translateRecent = 5,
  ) {}

  /** 读快照。内存空(首次部署、定时任务尚未跑成)→ 同步兜底刷新一次;仍失败则上抛 → 500。 */
  async get(): Promise<Snapshot> {
    if (!this.memory) await this.refresh()
    return this.memory!
  }

  /** 启动时从快照表恢复本源内存镜像:零外呼、零 LLM。本源无行则无操作,等定时/兜底路径。 */
  async loadFromDb(): Promise<void> {
    const row = await this.db
      .selectFrom('changelog_snapshots')
      .selectAll()
      .where('source', '=', this.source)
      .executeTakeFirst()
    if (!row) return
    const blocks = splitBlocks(row.raw_markdown)
    this.memory = this.assemble(blocks, await this.loadTranslations(blocks), row.released_at)
  }

  /** 定时/预热刷新:拉原文 → 只译最近 N 版中缺失的块 → 快照落库 → 换内存镜像。拉取失败上抛,由调度方决定降级。 */
  async refresh(): Promise<void> {
    return this.exclusive(() => this.doRefresh())
  }

  /** 前端按需补译(ADR-0017):指定版本缺失则译、入库、重拼。已译的跳过(零 LLM),失败的该版保持英文。 */
  async translateVersions(titles: string[]): Promise<Snapshot> {
    return this.exclusive(async () => {
      if (!this.memory) await this.doRefresh() // 冷启动兜底(锁内,不可走加锁版防自锁)
      const { blocks, releasedAt } = this.memory!
      const byHash = await this.loadTranslations(blocks)
      for (const b of blocks.blocks) {
        if (titles.includes(b.title)) await this.translateIfMissing(b, byHash)
      }
      this.memory = this.assemble(blocks, byHash, releasedAt)
      return this.memory
    })
  }

  private async doRefresh(): Promise<void> {
    const raw = await this.deps.fetchMarkdown()
    const blocks = splitBlocks(raw)
    const byHash = await this.loadTranslations(blocks)
    for (const b of blocks.blocks.slice(0, this.translateRecent)) {
      await this.translateIfMissing(b, byHash)
    }
    const releasedAt = await this.deps.fetchReleasedAt()
    const fetchedAt = nowIso()
    await this.db
      .insertInto('changelog_snapshots')
      .values({ source: this.source, raw_markdown: raw, released_at: releasedAt, fetched_at: fetchedAt })
      .onConflict((oc) =>
        oc
          .column('source')
          .doUpdateSet({ raw_markdown: raw, released_at: releasedAt, fetched_at: fetchedAt }),
      )
      .execute()
    this.memory = this.assemble(blocks, byHash, releasedAt)
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn) // 前者失败不阻塞后来者
    this.tail = run.catch(() => {})
    return run
  }

  /** 译一个块:哈希命中直接返回(零 LLM);译成则入库;失败/拒绝仅 warn,不入库待下轮重试。 */
  private async translateIfMissing(block: Block, byHash: Map<string, string>): Promise<void> {
    const hash = sha256(block.raw)
    if (byHash.has(hash)) return
    let translated: string | null
    try {
      translated = await this.deps.translate(block.raw)
    } catch (e) {
      console.warn(`版本 ${block.title} 译制失败,保持英文:`, e)
      return
    }
    if (translated == null) {
      console.warn(`版本 ${block.title} 译制被拒绝(API Key 缺失?),保持英文`)
      return
    }
    await this.db
      .insertInto('changelog_translations')
      .values({ block_hash: hash, translated, created_at: nowIso() })
      .execute()
    byHash.set(hash, translated)
  }

  /** 批量捞现有译文 → 哈希 → 译文 映射(拼装与缺失比对共用一次查询)。 */
  private async loadTranslations(blocks: Blocks): Promise<Map<string, string>> {
    const hashes = blocks.blocks.map((b) => sha256(b.raw))
    // 实测 361 版,远低于 SQLite 单语句参数上限(32766),不分批
    const rows = hashes.length
      ? await this.db
          .selectFrom('changelog_translations')
          .selectAll()
          .where('block_hash', 'in', hashes)
          .execute()
      : []
    return new Map(rows.map((r) => [r.block_hash, r.translated]))
  }

  /** 拼装:前缀 + 每块取译文(哈希命中)或原文。translatedVersions 与拼装同源。 */
  private assemble(blocks: Blocks, byHash: Map<string, string>, releasedAt: string | null): Snapshot {
    let markdown = blocks.prefix
    const translatedVersions: string[] = []
    for (const b of blocks.blocks) {
      const translated = byHash.get(sha256(b.raw))
      if (translated !== undefined) {
        markdown += translated
        translatedVersions.push(b.title)
      } else {
        markdown += b.raw
      }
    }
    return { markdown, releasedAt, translatedVersions, blocks }
  }
}

// ---- HTTP 路由(Java ChangelogController,契约 api-contract.md §6;?source 分流见 ADR-0020)----

/** 源 id → Service 映射;index.ts 按 CHANGELOG_SOURCES 逐源构造。 */
export type ChangelogServices = Record<ChangelogSourceId, ChangelogService>

export function changelogRoutes(services: ChangelogServices): Hono<AuthEnv> {
  /** ?source= 选源;缺省/未知回落默认源(前端 changelogSourceOf 已兜底,此处双保险)。 */
  const pick = (c: Context<AuthEnv>) =>
    services[(c.req.query('source') as ChangelogSourceId) ?? DEFAULT_CHANGELOG_SOURCE] ??
    services[DEFAULT_CHANGELOG_SOURCE]
  const toResponse = (s: Snapshot) => ({
    markdown: s.markdown,
    releasedAt: s.releasedAt, // 失败时显式 null(输出不省略),前端日期行降级「—」
    translatedVersions: s.translatedVersions,
  })
  return new Hono<AuthEnv>()
    .get('/api/changelog', async (c) => c.json(toResponse(await pick(c).get())))
    .post('/api/changelog/translate', async (c) => {
      const body = await c.req.json().catch(() => null)
      const versions = (body as { versions?: unknown } | null)?.versions
      const list = Array.isArray(versions) ? versions.filter((v): v is string => typeof v === 'string') : []
      return c.json(toResponse(await pick(c).translateVersions(list)))
    })
}

// ---- 生产协作器(Java ChangelogConfig/NpmReleaseDateService 对应物;源定义在 shared)----

const LLM_BASE_URL = 'https://aihubmix.com/v1'

/** 译制系统提示(照搬 Java,ADR-0005):确定性靠提示约束,GPT-5 系 temperature 被网关忽略。 */
const SYSTEM_PROMPT = `你是专业技术译者。把用户给出的 CHANGELOG markdown 片段由英文译成简体中文。
严格约束：
1. 只输出译制后的 markdown 片段本身，不要任何解释、前后缀、也不要代码围栏 \`\`\`。
2. 原样保留全部结构：## / ### 标题层级、- 列表符号、空行。
3. 原样保留全部行内 markdown：\`code\`、**bold**、[text](url)。
4. 不要翻译：版本号（如 1.2.3）、代码片段内容、URL、命令名、配置键名。
5. 通用技术术语（Claude Code、API、token、hook 等）可保留原文或按惯例中译。`

async function fetchText(url: string, timeoutMs: number, init?: RequestInit): Promise<string> {
  // 超时防挂起(ADR-0017):外呼挂死会让定时预取永不返回;LLM 译一大块可达分钟级
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok)
    // status/body 挂错误上:调用方据此分类(free 候选链按 403/404/no_available_channel 换下一个)
    throw Object.assign(new Error(`${init?.method ?? 'GET'} ${url} → HTTP ${res.status}`), {
      status: res.status,
      body: (await res.text()).slice(0, 200),
    })
  return res.text()
}

/** 从 OpenAI 兼容响应取 choices[0].message.content;任何畸形形态返回 null(调用方据此降级英文)。 */
export function extractContent(resp: unknown): string | null {
  const choices = (resp as { choices?: unknown } | null)?.choices
  if (!Array.isArray(choices) || choices.length === 0) return null
  const content = (choices[0] as { message?: { content?: unknown } })?.message?.content
  return typeof content === 'string' ? content : null
}

/**
 * 译制模型候选链(2026-08-23):free 优先,free 全不可用落到付费 coding-glm-5.2。
 * 候选失效 = 403/404(模型被禁/不存在)或 400 no_available_channel(渠道没了);其他错误(401 key/网络/5xx)换模型无益,直接抛。
 * CHANGELOG_LLM_MODEL 支持逗号分隔列表覆盖;Key 沿用 AIHUBMIX_API_KEY。
 */
export const DEFAULT_LLM_MODELS = 'coding-glm-5.1-free,coding-kimi-k3-free,gemini-3.6-flash-free,coding-glm-5.2'

export function modelCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  // 空串回退默认:compose 引用行对 .env 缺省键注入的是 ''(非 undefined),split 后会是空列表
  return (env.CHANGELOG_LLM_MODEL?.trim() || DEFAULT_LLM_MODELS).split(',').map((m) => m.trim()).filter(Boolean)
}

/** 网关对该候选「没戏了,换下一个」的判定:模型被禁/不存在/无渠道。 */
function isCandidateExhausted(e: unknown): boolean {
  const err = e as { status?: number; body?: string }
  return err?.status === 403 || err?.status === 404 || /no_available_channel/.test(err?.body ?? '')
}

export function prodChangelogDeps(source: ChangelogSourceId = DEFAULT_CHANGELOG_SOURCE): ChangelogDeps {
  const def = getChangelogSource(source)
  const apiKey = process.env.AIHUBMIX_API_KEY ?? ''
  const models = modelCandidates()
  return {
    fetchMarkdown: () => fetchText(def.changelogUrl, 60_000),
    fetchReleasedAt: async () => {
      try {
        const root = JSON.parse(
          await fetchText(`https://registry.npmjs.org/${def.npmPackage}`, 30_000),
        ) as {
          'dist-tags'?: { latest?: string }
          time?: Record<string, string>
        }
        const latest = root['dist-tags']?.latest
        const date = latest ? root.time?.[latest] : undefined
        return date?.trim() ? date : null
      } catch (e) {
        console.warn('拉取 npm 发布日期失败,日期行降级:', e)
        return null
      }
    },
    translate: async (block) => {
      if (!apiKey) return null // Key 缺失:Service 层据此透传英文原文
      let lastErr: unknown
      for (const model of models) {
        try {
          const resp = await fetchText(`${LLM_BASE_URL}/chat/completions`, 300_000, {
            method: 'POST',
            headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
            body: JSON.stringify({
              model,
              messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: block },
              ],
            }),
          })
          return extractContent(JSON.parse(resp))
        } catch (e) {
          if (!isCandidateExhausted(e)) throw e
          lastErr = e
          console.warn(`模型 ${model} 不可用(${(e as { status?: number }).status}),试下一候选`)
        }
      }
      throw lastErr
    },
  }
}

// ---- 定时预取(Java ChangelogScheduler)----

/** 启动两步:先恢复快照(零外呼)再异步预热;此后每 6h 刷新。失败沿用旧快照(最多旧 6h)。
 *  逐源各一套(ADR-0020):每源独立恢复/预热/定时,一源失败不涉其它。 */
export function startChangelogScheduler(services: readonly ChangelogService[]): void {
  for (const service of services) {
    const refreshQuietly = () =>
      service.refresh().catch((e) => console.warn(`更新日志(${service.source})定时刷新失败,沿用现有快照:`, e))
    void service.loadFromDb().then(refreshQuietly)
    schedule('0 */6 * * *', () => void refreshQuietly())
  }
}
