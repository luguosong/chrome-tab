import { useMemo, useState, type FormEvent } from 'react'
import { useCreateIcon } from '../api/config'
import { useSiteInfoAutofill } from '../api/siteInfo'
import { ApiError } from '../api/client'
import { canAdd, listTypes, type IconTypeDefinition } from '../lib/iconTypeRegistry'
import { EditorFields, missingRequiredText, serializeFields } from './editorFields'
import type { IconTypeId } from '../lib/types'

/**
 * 新增面板(见 CONTEXT.md「新增抽屉」/ issue 09):ControlDrawer 的「新增」tab 内容。
 *
 * 与编辑模式职责分离——选类型填表单即填即加到当前页末尾。类型卡片按基础/扩展分区
 * (从注册表 listTypes 读取),每张内嵌该类型 `editor` 声明的配置表单。单例类型已存在时
 * 置灰(注册表 canAdd 判断)。提交调 useCreateIcon → POST /api/icons,react-query 失效后
 * 即时出现;抽屉保持打开以连续添加。壳(遮罩/Esc/顶栏)由 ControlDrawer 统一持有。
 */
export function AddPane({
  pageId,
  existingTypeIds,
}: {
  /** 当前激活页 id——新图标落到此页末尾。undefined 时禁用提交(无页可加)。 */
  pageId: number | undefined
  /** 当前用户全部图标出现的类型集合——用于单例置灰判断(单例=全局唯一,跨页)。 */
  existingTypeIds: IconTypeId[]
}) {
  const types = useMemo(() => listTypes(), [])
  const base = types.filter((t) => t.kind === 'base')
  const ext = types.filter((t) => t.kind === 'extension')

  return (
    <>
      {pageId === undefined && (
        <div className="text-sm text-white/60">无可用页面 · 先在底部页签条新建页,再回来添加</div>
      )}
      <TypeSection title="基础" defs={base} pageId={pageId} existingTypeIds={existingTypeIds} />
      <TypeSection title="扩展" defs={ext} pageId={pageId} existingTypeIds={existingTypeIds} />
    </>
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
      <h3 className="mb-2 text-meta uppercase tracking-wider text-white/50">{title}</h3>
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

/** 表单初值:普通字段空串,带 default 的字段(如 changelog 源下拉)取默认。初始化与提交后重置共用。 */
function initialValues(def: IconTypeDefinition): Record<string, unknown> {
  return Object.fromEntries(def.editor.map((f) => [f.name, 'default' in f ? f.default : '']))
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
  const [values, setValues] = useState<Record<string, unknown>>(() => initialValues(def))
  // 字段臂上报的本地处理 busy(nav 图标上传),期间禁提交——此前新增侧缺这道门(编辑侧有)
  const [armBusy, setArmBusy] = useState(false)

  // nav:网址停顿后自动加载站点信息(CONTEXT.md「站点信息」)——title 只在名称为空时
  // 填入,图标候选由 icon 臂的 IconPicker 消费(共享 hook,与编辑 EditForm 一致)。
  useSiteInfoAutofill(def.id === 'nav', String(values['url'] ?? ''), setValues)

  function setField(name: string, v: unknown) {
    setValues((prev) => ({ ...prev, [name]: v }))
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (pageId === undefined) return
    if (missingRequiredText(def.editor, values) !== undefined) return
    // mutateAsync:成功才清空表单(抽屉保持打开以连续添加,issue 09);
    // 失败抛出由 react-query 记录到 create.error,UI 据此展示提示。
    try {
      await create.mutateAsync({
        pageId,
        type: def.id,
        data: serializeFields(def.editor, values),
      })
      setValues(initialValues(def))
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
      <div className="glass-soft rounded-2xl p-4 opacity-60">
        <div className="flex items-center justify-between">
          <span className="text-sm text-white/80">{def.label}</span>
          <span className="text-meta text-white/50">已添加</span>
        </div>
      </div>
    )
  }

  const noPage = pageId === undefined
  const missing = missingRequiredText(def.editor, values)
  // 格数徽标取真实画格跨度(ADR-0021:缺省 1×1)——加块前告知占地
  const span = def.span ?? { w: 1, h: 1 }
  return (
    <form onSubmit={submit} className="glass-soft rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-white/95">{def.label}</span>
        <span
          aria-label={`占 ${span.w}×${span.h} 格`}
          className="rounded-full bg-white/10 px-2 py-0.5 font-mono text-meta tabular-nums text-white/60"
        >
          {span.w}×{span.h}
        </span>
      </div>

      {/* 字段渲染唯一分派点(臂表),add/edit 两路共用,见 editorFields.tsx;
          changelog 仅一个源下拉字段,editor 为空的类型直接一个提交按钮 */}
      <EditorFields fields={def.editor} values={values} setField={setField} onBusyChange={setArmBusy} />

      {errorMsg && <div className="text-xs text-down">{errorMsg}</div>}

      <button
        type="submit"
        disabled={create.isPending || noPage || missing !== undefined || armBusy}
        className="w-full rounded-full bg-accent py-1.5 text-sm font-medium text-white transition hover:bg-accent/90
          active:bg-accent/80 focus-visible:outline-2 focus-visible:outline-white/60 disabled:opacity-50"
      >
        {create.isPending ? '添加中…' : missing ?? `添加${def.label}`}
      </button>
    </form>
  )
}
