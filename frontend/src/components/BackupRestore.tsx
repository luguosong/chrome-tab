import { useState, type ChangeEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useReplaceConfig } from '../api/config'
import { ApiError } from '../api/client'
import type { Config } from '../lib/types'
import { mergeBlobs, parseBackupPayload, toBackupPayload, type WireConfig } from '../lib/mirror/backup'
import { downloadJson } from '../lib/mirror/download'

/**
 * 备份与恢复(ADR-0006):导出当前配置为 JSON;导入支持「替换」(清空服务端按备份重建)
 * 与「合并」(备份重键后追加,v1 不去重)。两者均走 PUT /api/config 全量替换。
 */
export function BackupRestore() {
  const qc = useQueryClient()
  const replace = useReplaceConfig()
  const [msg, setMsg] = useState<string | null>(null)

  function doExport() {
    const cfg = qc.getQueryData<Config>(['config'])
    if (!cfg) return
    downloadJson(`chrome-tab-backup-${new Date().toISOString().slice(0, 10)}.json`, toBackupPayload(cfg))
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>, mode: 'replace' | 'merge') {
    const f = e.target.files?.[0]
    e.target.value = '' // 允许重复选同一文件
    if (!f) return
    setMsg(null)
    try {
      const payload = parseBackupPayload(JSON.parse(await f.text()))
      const cur = qc.getQueryData<Config>(['config'])
      const body: WireConfig =
        mode === 'replace' ? payload.config : cur ? mergeBlobs(cur, payload.config) : payload.config
      await replace.mutateAsync(body)
      setMsg(mode === 'replace' ? '已替换' : '已合并')
    } catch (err) {
      if (err instanceof ApiError) setMsg('导入失败(' + err.status + '):' + (err.message ?? ''))
      else if (err instanceof Error) setMsg('导入失败:' + err.message)
      else setMsg('导入失败')
    }
  }

  return (
    <div className="mt-6 pt-4 border-t border-white/10">
      <h3 className="text-xs font-semibold text-white/80 mb-2">备份与恢复</h3>
      <div className="flex flex-wrap gap-2 text-xs">
        <button
          type="button"
          onClick={doExport}
          className="px-3 py-1.5 rounded-full glass-panel text-white/85 hover:bg-white/30 transition"
        >
          导出备份
        </button>
        <label className="px-3 py-1.5 rounded-full glass-panel text-white/85 hover:bg-white/30 cursor-pointer transition">
          导入(替换)
          <input type="file" accept="application/json" hidden onChange={(e) => onFile(e, 'replace')} />
        </label>
        <label className="px-3 py-1.5 rounded-full glass-panel text-white/85 hover:bg-white/30 cursor-pointer transition">
          导入(合并)
          <input type="file" accept="application/json" hidden onChange={(e) => onFile(e, 'merge')} />
        </label>
      </div>
      <p className="mt-2 text-[11px] text-white/50 leading-relaxed">
        导出当前全部配置为 JSON;「替换」清空服务端后按备份重建,「合并」把备份作为新内容追加(v1 不去重)。
      </p>
      {msg && <p className="mt-2 text-[11px] text-accent">{msg}</p>}
    </div>
  )
}
