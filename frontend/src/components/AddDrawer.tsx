import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useCreateIcon } from '../api/config'
import { ApiError } from '../api/client'
import { canAdd, listTypes, type IconTypeDefinition } from '../lib/iconTypeRegistry'
import { normalizeUrl } from '../lib/normalizeUrl'
import type { IconTypeId } from '../lib/types'

/**
 * 新增抽屉(见 CONTEXT.md「新增抽屉」/ issue 09)。
 *
 * 由 DashboardPage 右上角 "+" 唤起的侧抽屉,与编辑模式职责分离——选类型填表单即填即加到
 * 当前页末尾。类型卡片按基础/扩展分区(从注册表 listTypes 读取),每张内嵌该类型 `editor`
 * 声明的配置表单。单例类型已存在时置灰(注册表 canAdd 判断)。提交调 useCreateIcon →
 * POST /api/icons,react-query 失效后即时出现;抽屉保持打开以连续添加。
 *
 * 容器:fixed 右侧、从右滑入(animate-slide-in-right)、玻璃面板、关闭按钮;Esc / 遮罩关闭。
 */
export default function AddDrawer({
  pageId,
  existingTypeIds,
  onClose,
}: {
  /** 当前激活页 id——新图标落到此页末尾。undefined 时禁用提交(无页可加)。 */
  pageId: number | undefined
  /** 当前用户全部图标出现的类型集合——用于单例置灰判断(单例=全局唯一,跨页)。 */
  existingTypeIds: IconTypeId[]
  onClose: () => void
}) {
  const types = useMemo(() => listTypes(), [])
  const base = types.filter((t) => t.kind === 'base')
  const ext = types.filter((t) => t.kind === 'extension')

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[60] flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="新增图标"
    >
      {/* 遮罩:点击关闭 */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <aside className="glass-panel relative h-full w-full max-w-sm animate-slide-in-right overflow-y-auto">
        {/* 顶栏:标题 + 关闭 */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-3 border-b border-white/20 bg-[inherit]">
          <h2 className="text-sm uppercase tracking-wider text-white/80">新增图标</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="w-8 h-8 rounded-full bg-white/20 text-white/80 hover:bg-white/40 flex items-center justify-center"
          >
            ×
          </button>
        </div>

        <div className="px-5 py-4 space-y-6">
          {pageId === undefined && (
            <div className="text-sm text-white/60">无可用页面。</div>
          )}
          <TypeSection title="基础" defs={base} pageId={pageId} existingTypeIds={existingTypeIds} />
          <TypeSection title="扩展" defs={ext} pageId={pageId} existingTypeIds={existingTypeIds} />
        </div>
      </aside>
    </div>
  )
}

/** 一个分区:标题 + 其下类型卡片列表。 */
function TypeSection({
  title,
  defs,
  pageId,
  existingTypeIds,
}: {
  title: string
  defs: IconTypeDefinition[]
  pageId: number | undefined
  existingTypeIds: IconTypeId[]
}) {
  if (defs.length === 0) return null
  return (
    <section>
      <h3 className="text-[11px] uppercase tracking-wider text-white/50 mb-2">{title}</h3>
      <div className="space-y-3">
        {defs.map((def) => (
          <TypeCard
            key={def.id}
            def={def}
            pageId={pageId}
            disabled={!canAdd(def.id, existingTypeIds)}
          />
        ))}
      </div>
    </section>
  )
}

/** 单张类型卡片:内嵌该类型 editor 表单,提交即加到当前页。单例已存在 → 置灰。 */
function TypeCard({
  def,
  pageId,
  disabled,
}: {
  def: IconTypeDefinition
  pageId: number | undefined
  disabled: boolean
}) {
  const create = useCreateIcon()
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(def.editor.map((f) => [f.name, ''])),
  )

  function setField(name: string, v: string) {
    setValues((prev) => ({ ...prev, [name]: v }))
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (pageId === undefined) return
    // mutateAsync:成功才清空表单(抽屉保持打开以连续添加,issue 09);
    // 失败抛出由 react-query 记录到 create.error,UI 据此展示提示。
    try {
      await create.mutateAsync({
        pageId,
        type: def.id,
        size: def.defaultSize,
        data: buildData(def, values),
      })
      setValues(Object.fromEntries(def.editor.map((f) => [f.name, ''])))
    } catch {
      /* 错误已由 create.error 承载,errorMsg 转译展示 */
    }
  }

  // 错误转译:容量 409 → "此页已满…";其它(含单例竞态 409)展示后端 message
  const err = create.error
  const errorMsg =
    err instanceof ApiError && err.status === 409 && /容量/.test(err.message)
      ? '此页已满,请新建页面或移至其它页'
      : err instanceof Error
        ? err.message
        : ''

  if (disabled) {
    // 单例已存在:置灰、不可填、标注"已添加"(spec user story 20)
    return (
      <div className="rounded-2xl border border-white/15 bg-white/5 p-4 opacity-60">
        <div className="flex items-center justify-between">
          <span className="text-sm text-white/80">{def.label}</span>
          <span className="text-[11px] text-white/50">已添加</span>
        </div>
      </div>
    )
  }

  const noPage = pageId === undefined
  return (
    <form
      onSubmit={submit}
      className="rounded-2xl border border-white/20 bg-white/10 p-4 space-y-2.5"
    >
      <div className="text-sm text-white/90">{def.label}</div>

      {def.editor.map((f) => (
        <input
          key={f.name}
          value={values[f.name] ?? ''}
          onChange={(e) => setField(f.name, e.target.value)}
          placeholder={f.placeholder}
          aria-label={f.label}
          className="w-full px-3 py-2 rounded-lg bg-white/20 text-white placeholder-white/50 text-sm outline-none focus:ring-2 focus:ring-accent"
        />
      ))}

      {/* changelog(editor=[])无表单字段,直接一个提交按钮 */}

      {errorMsg && <div className="text-xs text-down">{errorMsg}</div>}

      <button
        type="submit"
        disabled={create.isPending || noPage}
        className="w-full rounded-lg bg-accent/90 hover:bg-accent disabled:opacity-50 text-white text-sm py-1.5 transition"
      >
        {create.isPending ? '添加中…' : `添加${def.label}`}
      </button>
    </form>
  )
}

/**
 * 从表单值构造该类型的 data。url 字段补 https:// 前缀(见 normalizeUrl);
 * 无 editor 字段的类型(如 changelog)返回 null。模块内纯函数——核心归一化逻辑
 * normalizeUrl 已被独立 Vitest 覆盖,此处仅做字段装配。
 */
function buildData(
  def: IconTypeDefinition,
  values: Record<string, string>,
): Record<string, unknown> | null {
  if (def.editor.length === 0) return null
  const data: Record<string, unknown> = {}
  for (const f of def.editor) {
    const v = (values[f.name] ?? '').trim()
    data[f.name] = f.name === 'url' ? normalizeUrl(v) : v
  }
  return data
}
