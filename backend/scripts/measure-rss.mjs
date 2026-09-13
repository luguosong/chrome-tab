// 强制 GC 后稳态 RSS 测量 —— research/01 方法的仓内复现(spec 票 02 验收项)。
// 起 dist/index.js(--expose-gc)→ 探针流量 → 双 GC → VmRSS 轮询至收敛 → 读 /proc/<pid>/status VmRSS。
// 用法:pnpm --filter chrome-tab-backend measure          # 打包形态(部署路径)
//      pnpm --filter chrome-tab-backend measure -- --source  # tsx 源码直跑形态
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const port = 18080
const source = process.argv.includes('--source')
const tmp = mkdtempSync(join(tmpdir(), 'tab-measure-'))

const args = source
  ? ['--expose-gc', '--import', 'tsx', 'src/index.ts']
  : ['--expose-gc', 'dist/index.js']
const child = spawn(process.execPath, args, {
  cwd: join(import.meta.dirname, '..'),
  env: { ...process.env, PORT: String(port), DB_PATH: join(tmp, 'measure.db') },
  stdio: ['ignore', 'inherit', 'inherit'],
})

const health = `http://127.0.0.1:${port}/healthz`
try {
  // 就绪轮询(总上限 ~10s;单次探活 500ms 超时——WSL2 对死端口丢弃而非拒绝,不设超时会悬挂)
  let up = false
  for (let i = 0; i < 20 && !up; i++) {
    try {
      up = (await fetch(health, { signal: AbortSignal.timeout(500) })).ok
    } catch {
      await delay(100)
    }
  }
  if (!up) throw new Error('server never became ready')

  for (let i = 0; i < 5; i++) await fetch(health) // 轻量流量,触发惰性初始化
  await fetch(`http://127.0.0.1:${port}/debug/gc`, { method: 'POST' })
  await fetch(`http://127.0.0.1:${port}/debug/gc`, { method: 'POST' })
  // 稳定窗口:轮询 VmRSS 至收敛(连续 5 次波动 ≤0.5 MiB,上限 60s)。固定 5s 短窗
  // (research/01 时代)在七服务启动预热时序不定时是瞬态读数,方差可达 ±60 MiB 量级。
  let rssKb = 0
  let stable = 0
  for (let i = 0; i < 30 && stable < 5; i++) {
    await delay(2000)
    const s = readFileSync(`/proc/${child.pid}/status`, 'utf8')
    const v = Number(/^VmRSS:\s+(\d+) kB$/m.exec(s)?.[1])
    stable = Math.abs(v - rssKb) <= 512 ? stable + 1 : 0
    rssKb = v
  }

  const form = source ? 'tsx 源码直跑' : 'esbuild 打包(部署路径)'
  console.log(`RSS(${form}, 强制 GC 后)= ${(rssKb / 1024).toFixed(1)} MiB`)
} finally {
  child.kill('SIGTERM')
  rmSync(tmp, { recursive: true, force: true })
}
