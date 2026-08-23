import type { Db } from './db'
import { hashPassword } from './password'

/**
 * 空库首启 seed,语义照搬 Java DataBootstrap:users 空 → ADMIN_PASSWORD 建 admin(缺失则抛错,
 * 启动失败);pages 空 → seed 3 页 26 图标(12 NAV + 1 CHANGELOG + 13 STOCK)+ config_version touch。
 * 每张表按自身 count 判断,互不依赖、可断点续 seed;非空全跳过(ADMIN_* 仅首启生效)。
 */

// 搬自 prototype/index.html 的 DEFAULT_NAV / STOCKS(独立于测试手抄清单,两侧对账)
const DEFAULT_NAV: ReadonlyArray<readonly [string, string]> = [
  ['GitHub', 'https://github.com'],
  ['谷歌', 'https://www.google.com'],
  ['StackOverflow', 'https://stackoverflow.com'],
  ['MDN', 'https://developer.mozilla.org'],
  ['知乎', 'https://www.zhihu.com'],
  ['掘金', 'https://juejin.cn'],
  ['V2EX', 'https://www.v2ex.com'],
  ['npm', 'https://www.npmjs.com'],
  ['React', 'https://react.dev'],
  ['Vue', 'https://vuejs.org'],
  ['B站', 'https://www.bilibili.com'],
  ['HN', 'https://news.ycombinator.com'],
]
const DEFAULT_STOCKS: ReadonlyArray<readonly [string, string]> = [
  ['usAAPL', '苹果'], ['usMSFT', '微软'], ['usNVDA', '英伟达'], ['usTSLA', '特斯拉'],
  ['usGOOGL', '谷歌'], ['usDJI', '道指'], ['usIXIC', '纳指'], ['usINX', '标普500'],
  ['sh000001', '上证指数'], ['sz399001', '深证成指'], ['sz399006', '创业板指'],
  ['sh600519', '贵州茅台'], ['sz300750', '宁德时代'],
]

export async function bootstrap(
  db: Db,
  admin: { username: string; password?: string },
): Promise<void> {
  const existing = await db.selectFrom('users').select('id').orderBy('id').execute()
  const userId =
    existing[0]?.id ??
    (await createUser(db, admin.username, admin.password))
  await seedPagesAndIcons(db, userId)
}

async function createUser(db: Db, username: string, password: string | undefined): Promise<number> {
  if (!password || !password.trim()) {
    throw new Error('首次启动必须设置环境变量 ADMIN_PASSWORD')
  }
  const { id } = await db
    .insertInto('users')
    .values({ username, password: await hashPassword(password), created_at: new Date().toISOString() })
    .returning('id')
    .executeTakeFirstOrThrow()
  console.warn(`已从 ADMIN_PASSWORD 创建管理员 '${username}',登录后请改密`)
  return id
}

async function seedPagesAndIcons(db: Db, userId: number): Promise<void> {
  const hasPages = await db.selectFrom('pages').select('id').limit(1).executeTakeFirst()
  if (hasPages) return

  const now = new Date().toISOString()
  await db.transaction().execute(async (tx) => {
    const [navPage, changelogPage, stockPage] = await tx
      .insertInto('pages')
      .values([
        { user_id: userId, name: '快速导航', sort_order: 0, created_at: now },
        { user_id: userId, name: '日志更新', sort_order: 1, created_at: now },
        { user_id: userId, name: '行情', sort_order: 2, created_at: now },
      ])
      .returning('id')
      .execute()

    await tx.insertInto('icons').values([
      ...DEFAULT_NAV.map(([name, url], so) => ({
        user_id: userId, page_id: navPage.id, parent_id: null, type: 'NAV', sort_order: so,
        data: JSON.stringify({ name, url }), created_at: now,
      })),
      {
        // data.source 见 ADR-0020(存量库 data=null 的旧图标读侧兜底归默认源,前端 changelogSourceOf)
        user_id: userId, page_id: changelogPage.id, parent_id: null, type: 'CHANGELOG', sort_order: 0,
        data: JSON.stringify({ source: 'claude-code' }), created_at: now,
      },
      // ponytail: Java 版有 >64 只股票溢出追加页逻辑,DEFAULT_STOCKS 恒 13 只 < 64,死分支不搬
      ...DEFAULT_STOCKS.map(([symbol, name], so) => ({
        user_id: userId, page_id: stockPage.id, parent_id: null, type: 'STOCK', sort_order: so,
        data: JSON.stringify({ symbol, name }), created_at: now,
      })),
    ]).execute()

    // 种子数据落初始 config_version:首拉即有确定版本,前端镜像可比(ADR-0006)
    await tx
      .insertInto('config_version')
      .values({ user_id: userId, updated_at: now })
      .onConflict((oc) => oc.column('user_id').doUpdateSet({ updated_at: now }))
      .execute()
  })
  console.info('已 seed 3 页 / 26 图标')
}
