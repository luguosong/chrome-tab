import { useEffect, useState, type CSSProperties } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { get, type EditorField, type IconTypeDefinition } from '../lib/iconTypeRegistry'
import ConfirmButton from './ConfirmButton'
import { ICON_TYPE_UI } from './iconTypeUi'
import type { Icon as IconModel } from '../lib/types'
import { useEditMode } from '../context/EditModeContext'
import { useGroupGesture } from '../context/GroupGestureContext'
import { LABEL_GAP_PX } from '../lib/iconLayout'
import { extractString } from '../lib/iconData'
import { useSiteInfoAutofill } from '../api/siteInfo'
import { useDeleteIcon, useDissolveGroup, useUpdateIconData } from '../api/config'
import { ApiError } from '../api/client'
import { EditorFields, prefillFields, serializeFields } from './editorFields'

/**
 * 单个图标渲染(见 CONTEXT.md「图标」/ spec §前端架构 IconGrid / ADR-0012 图标层换肤)。
 *
 * 所有图标一律占 1 格(ADR-0016 单档化),且统一「上块下字」结构(ADR-0016 注记
 * 2026-08-23b):squircle 玻璃块(TileFrame,同一 faviconPx 边长推导)+ 外置一行文字
 * (IconLabel,同一 labelSize 行高)——视觉尺寸一致由共享几何保证,不靠各类型目测对齐。
 * 各类型图标块由 iconTypeUi 静态 adapter 选择;本组件只保留共享外壳语义。
 *
 * 点击行为(按 adapter 的可选详情 renderer + 入口策略派发):
 *   - 编辑模式:不触发任何详情/跳转(角标操作优先,spec user story 29)
 *   - nav:渲染为 <a>(新标签打开目标 URL,spec user story 13)
 *   - block 入口:查看态点击 → onOpenDetail(icon),父组件渲染 adapter 详情;
 *     跨格大 tile(aihot/changelog,ADR-0022)整块点击无操作,openDetail 下发给
 *     body 的「更多」按钮直调——详情唯一入口
 *
 * 拖拽(06):本组件是网格画格(grid item),故 useSortable 直接挂在此处。
 * 查看模式与编辑模式均可拖。激活策略由 DashboardPage 的 Mouse/TouchSensor 决定(鼠标移动即拖、
 * 触控长按拖),点击(轻点)因激活阈值/延迟与拖拽分流,链接/详情照常打开。attributes 仅在
 * 编辑模式注入(保留 nav `<a>` 原生 role=link 语义与无障碍行为),listeners 在两种模式都注入。
 * 编辑模式角标(EditActions)的交互按钮 onPointerDown stopPropagation,避免点角标误启拖拽。
 */

export default function Icon({
  icon,
  onOpenDetail,
  onOpenGroup,
  overlay = false,
}: {
  icon: IconModel
  onOpenDetail?: (icon: IconModel) => void
  /** 点组图标开分组弹层(票 08)。任意模式可用(组内排序需编辑模式,弹层内自判)。 */
  onOpenGroup?: (icon: IconModel) => void
  /**
   * DragOverlay 中的拖拽幽灵(06):由 DashboardPage 在拖拽期间渲染一份只读副本跟随光标,
   * 原位置降级为占位(dimmed)。overlay 模式下不挂载 sortable 接线、不渲染编辑角标、
   * 不应用 jiggle,仅复用本组件的视觉(favicon/名称/摘要)以保证幽灵与原图标一致。
   */
  overlay?: boolean
}) {
  const def = get(icon.type)
  const ui = ICON_TYPE_UI[icon.type]
  const { editing } = useEditMode()
  const delIcon = useDeleteIcon()
  const editIcon = useUpdateIconData()
  // 分组 × = 解散(POST dissolve),区别于普通图标 × 的删除;容量 409 提示见下方浮层
  const dissolve = useDissolveGroup()
  useEffect(() => {
    if (!dissolve.isError) return
    const t = window.setTimeout(() => dissolve.reset(), 2600)
    return () => window.clearTimeout(t)
  }, [dissolve.isError])
  // 合并手势悬停达标(编辑模式拖 A 悬停本图标达阈值):放大反馈,松手建组/入组
  const dwellTarget = useGroupGesture()
  // 编辑配置 popover(✎)。
  const [editOpen, setEditOpen] = useState(false)

  // 拖拽(06):查看模式与编辑模式均启用。
  // overlay 副本强制 disabled,避免在 DragOverlay(脱离 SortableContext)里重复注册可拖节点。
  // 点击与拖拽的分流由 DashboardPage 的 Mouse/TouchSensor 激活策略负责(鼠标移动即拖、触控长按)。
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: icon.id,
    disabled: overlay,
  })

  const style: CSSProperties = {
    // 拖拽变换仅作用于网格内本体(06);overlay 幽灵由 DragOverlay 负责定位,不重复套 transform。
    ...(!overlay
      ? {
          transform: CSS.Transform.toString(transform),
          transition,
          ...(isDragging ? { opacity: 0.4, zIndex: 20 } : null),
        }
      : null),
    // 跨格尺寸(ADR-0021):声明 size 的类型 span 多列/行,位置仍是顺序流——CSS grid
    // 自动把后续图标排到跨格块之后。overlay 幽灵在画格外,不 span。
    ...(!overlay && def?.size
      ? { gridColumn: `span ${def.size.w}`, gridRow: `span ${def.size.h}` }
      : null),
  }

  const url = icon.type === 'nav' ? extractString(icon.data, 'url') : ''

  // 点击派发(UI adapter 契约:可选详情 renderer 决定有无详情,detailEntry 决定入口):
  //   - group:点开分组弹层(票 08)——任意模式(编辑态也要先开弹层才能组内排序)
  //   - nav:查看模式渲染为 <a> 当前标签打开(保留原生中键/右键菜单)
  //   - 其余类型:编辑模式一律不触发;查看模式按 detailEntry 开详情
  //     - block:整块点击(单格类型与跨格无滚动主体的天气 3×1)
  //     - header:跨格滚动大 tile 的块内「更多」按钮直调(openDetail 下发给 body),
  //       整块点击无操作(ADR-0022)
  const isNavLink = icon.type === 'nav' && !editing
  const Tag = isNavLink ? 'a' : 'div'
  const linkProps = isNavLink
    ? { href: url }
    : {}
  const hasPanel = ui.detail !== undefined
  // 组图标点击 = 开弹层(票 08):任意模式(编辑态开弹层才能组内排序),不与编辑态互斥
  const onGroupOpen = icon.type === 'group' && onOpenGroup ? () => onOpenGroup(icon) : undefined
  const openDetail = !editing && hasPanel && onOpenDetail ? () => onOpenDetail(icon) : undefined
  const onClick = onGroupOpen ?? (ui.detailEntry === 'header' ? undefined : openDetail)

  const interactive = isNavLink || onClick !== undefined
  const Body = ui.body

  return (
    <Tag
      ref={overlay ? undefined : setNodeRef}
      // 画格「块↔名称行」间距与 lib/iconLayout 的 labelBlockPx 同源(常数,非 gap-1 目测)
      style={{ gap: LABEL_GAP_PX, ...style }}
      {...linkProps}
      {...(editing && !overlay ? attributes : {})}
      {...(overlay ? {} : listeners)}
      onClick={onClick}
      title={def?.label}
      className={
        // 画格透明居中:玻璃块在图标层(Tile,全类型同款),文字在块外画格上
        // (iOS 主屏式:块=图标本体,文字=壁纸层)。不能加 overflow-hidden:编辑角标在卡外。
        // focus-visible 焦点环挂在 interactive 分支:一处覆盖 nav <a> 与 modal 可点块全类型
        // (键盘可达性;Tile 的 hover:scale-110 active:scale-95 在块层,此处不重复)。
        'relative flex flex-col items-center justify-center transition ' +
        (interactive
          ? 'cursor-pointer focus-visible:outline-2 focus-visible:outline-white/60 focus-visible:outline-offset-2'
          : 'cursor-default') +
        // 合并手势达标放大(dwell):目标非被拖项、无 dnd transform 冲突;transition 已有
        (dwellTarget === icon.id && !overlay ? ' scale-[1.15] z-10 ' : '') +
        (editing && !overlay ? ' editing-jiggle cursor-grab active:cursor-grabbing' : '') +
        (isDragging && !overlay ? ' ring-2 ring-accent' : '') +
        (overlay ? ' shadow-2xl ring-2 ring-accent cursor-grabbing' : '')
      }
    >
      <Body icon={icon} overlay={overlay} onOpenDetail={openDetail} />

      {/* 分组解散失败提示(容量 409「先移出部分图标」等):组图标上方小气泡,短暂显示 */}
      {icon.type === 'group' && dissolve.isError && (
        <span className="absolute -top-9 left-1/2 -translate-x-1/2 z-40 glass-panel rounded-full px-3 py-1 text-xs text-white/90 whitespace-nowrap shadow-lg pointer-events-none">
          {dissolve.error instanceof ApiError ? dissolve.error.message : '解散失败'}
        </span>
      )}

      {/* 编辑模式角标:编辑配置 ✎ + 删除 ×(spec user story 27/28;尺寸切换已随
          ADR-0016 单档化移除)。× 为破坏性操作,走 ConfirmButton 二次确认(首击武装
          「确认?」再击执行);确认后 DELETE/dissolve,乐观更新 + 失败回滚见 api/config.ts。
          overlay 幽灵不渲染角标(拖拽副本不带交互控件)。 */}
      {editing && !overlay && (
        <EditActions
          icon={icon}
          def={def}
          editOpen={editOpen}
          setEditOpen={setEditOpen}
          busy={delIcon.isPending || editIcon.isPending || dissolve.isPending}
          onDelete={() =>
            icon.type === 'group' ? dissolve.mutate(icon.id) : delIcon.mutate(icon.id)
          }
          onEdit={(data) => editIcon.mutate({ id: icon.id, data })}
        />
      )}
    </Tag>
  )
}

// ── 辅助 ──────────────────────────────────────────────────────────────────

/**
 * 编辑模式角标集群(右上角):编辑配置 ✎ + 删除 ×。
 * (尺寸切换菜单已随 ADR-0016 单档化移除。)
 * 所有点击 stopPropagation,避免冒泡到图标 Tag——组图标的 Tag 在编辑态也有 onClick
 * (开分组弹层),ConfirmButton 内部按钮不带 stopPropagation,故 click/contextmenu 的
 * 阻止与既有 pointerdown 一样上提到本容器统一处理。
 * onPointerDown 也 stopPropagation(06 拖拽):否则在角标上长按会触发 PointerSensor
 * 启动拖拽而非点击角标;阻止指针事件冒泡到挂载 listeners 的 Tag。
 */
function EditActions({
  icon,
  def,
  editOpen,
  setEditOpen,
  busy,
  onDelete,
  onEdit,
}: {
  icon: IconModel
  def: IconTypeDefinition | undefined
  editOpen: boolean
  setEditOpen: (v: boolean) => void
  busy: boolean
  onDelete: () => void
  onEdit: (data: Record<string, unknown> | null) => void
}) {
  // 仅 editor 非空的类型出现编辑配置 ✎——含 changelog(✎ 弹层经 source 臂同款下拉改绑外源)。
  const editor = def?.editor ?? []
  const showEdit = editor.length > 0
  // 删除/解散确认文案要带图标名(下方 ConfirmButton 的 aria-label)
  const name = extractString(icon.data, 'name')
  return (
    <>
      <div
        className="absolute -top-2 -right-2 z-20 flex items-center gap-1"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.stopPropagation()}
      >
        {/* 编辑配置 ✎:打开 popover(字段预填)。w-8 命中区(原 w-6 偏小),视觉仍轻
            (glass-panel 底 + 11px 字号不变);active:bg-white/40 与 hover 同为提亮语汇 */}
        {showEdit && (
          <button
            type="button"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation()
              setEditOpen(!editOpen)
            }}
            onContextMenu={(e) => e.stopPropagation()}
            className="glass-panel w-8 h-8 rounded-full text-meta leading-none text-white/90 flex items-center justify-center hover:bg-white/40 active:bg-white/40 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-white/60"
            title="编辑"
          >
            ✎
          </button>
        )}
        {/* 删除 ×:破坏性二次确认(ConfirmButton,首击武装「确认?」再击执行,自带
            热区外扩与焦点环)。组图标删除即解散,文案区分;busy 禁用防确认后连击
            重复触发请求(armed 状态点击后不自动解除,靠 busy 门控兜住) */}
        <ConfirmButton
          label={icon.type === 'group' ? `删除分组 ${name}` : `删除 ${name}`}
          title={icon.type === 'group' ? '解散分组(子图标洒回本页)' : '删除图标(不可恢复)'}
          onConfirm={onDelete}
          disabled={busy}
        />
      </div>

      {/* 编辑配置 popover:仅 editor 非空的类型(nav/stock/weather)打开时渲染 */}
      {editOpen && (
        <EditForm
          fields={editor}
          icon={icon}
          busy={busy}
          onCancel={() => setEditOpen(false)}
          onSave={(data) => {
            onEdit(data)
            setEditOpen(false)
          }}
        />
      )}
    </>
  )
}

/**
 * 编辑配置 popover(见 CONTEXT.md「编辑模式」)。从图标当前 data 预填类型 editor 声明的字段,
 * 保存走 useUpdateIconData(PATCH /api/icons/{id} body={data}),取消直接关闭。字段的渲染 /
 * 预填 / 序列化语义都在臂上(editorFields seam),与 AddDrawer 消费同一份,新增与编辑不漂移。
 *
 * 容器用 `fixed inset-0` 透明遮罩(z-[60],click-outside 取消)+ absolute 面板(z-[61])。
 * onPointerDown stopPropagation 防止冒泡到 Tag 触发拖拽(同 EditActions 角标,见 06)。
 * z 取 60/61:分组弹层容器 fixed z-40,遮罩须盖住弹层面板(点弹层任意处取消)才在
 * GroupOverlay 的 MemberTile 场景可用;网格场景无更高层,提升无副作用。
 * 导出供 GroupOverlay 的 MemberTile 复用(组内子图标编辑,2026-08-26)。
 */
export function EditForm({
  fields,
  icon,
  busy,
  onSave,
  onCancel,
}: {
  fields: EditorField[]
  icon: IconModel
  busy: boolean
  onSave: (data: Record<string, unknown> | null) => void
  onCancel: () => void
}) {
  // 预填当前 data;组件仅在 editOpen 时挂载,故初值即打开瞬间的快照。
  // 逐字段预填语义在臂上(prefillFields:location 走 readWeatherLocation、source 走
  // changelogSourceOf 存量兜底显示生效源),见 editorFields.tsx。
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    prefillFields(fields, icon.data),
  )
  // 字段臂上报的本地处理 busy(nav 图标上传),期间禁保存
  const [armBusy, setArmBusy] = useState(false)
  // nav:改网址后重新抓站点信息(图标候选随新网址刷新;名称已有值不覆盖——名称是
  // 用户的标签,与「图标覆盖」同为显式意图优先)。共享 hook,与新增抽屉一致。
  useSiteInfoAutofill(icon.type === 'nav', String(values['url'] ?? ''), setValues)
  function setField(name: string, v: unknown) {
    setValues((prev) => ({ ...prev, [name]: v }))
  }
  return (
    <>
      {/* 透明遮罩:点击任意处取消 */}
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation()
          onCancel()
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className="fixed inset-0 z-[60] cursor-default"
      />
      <div
        // glass-panel-readable:面板叠在壁纸/其他玻璃层上仍保文字对比(与 SymbolPicker/
        // LocationPicker 下拉对齐);min-w-[240px] 容纳统一输入族(px-3 py-2 text-sm 变宽)
        className="absolute top-5 right-0 z-[61] glass-panel glass-panel-readable rounded-lg p-2 min-w-[240px] space-y-2"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // Esc 关闭:面板本身不可聚焦,但输入框聚焦时键盘事件冒泡到面板即触发。
          // stopPropagation 防 Esc 继续冒泡(编辑模式无拖拽进行时才有表单,不与 dnd-kit 冲突)
          if (e.key === 'Escape') {
            e.stopPropagation()
            onCancel()
          }
        }}
      >
        {/* 字段渲染唯一分派点(臂表),add/edit 两路共用,见 editorFields.tsx */}
        <EditorFields fields={fields} values={values} setField={setField} onBusyChange={setArmBusy} />
        {/* 胶囊按钮族:取消=次级(min-h-8 圆胶囊 + 焦点环),保存=主按钮语汇
            (bg-accent/90 圆胶囊,对齐 AddDrawer;active:bg-accent/75 按压变暗反馈) */}
        <div className="flex gap-2 justify-end pt-0.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onCancel()
            }}
            className="px-3 py-1.5 min-h-8 rounded-full text-xs text-white/80 hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-white/60"
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy || armBusy}
            onClick={(e) => {
              e.stopPropagation()
              onSave(serializeFields(fields, values))
            }}
            className="px-3.5 py-1.5 min-h-8 rounded-full bg-accent/90 hover:bg-accent active:bg-accent/75 disabled:opacity-50 text-white text-xs focus-visible:outline-2 focus-visible:outline-white/60"
          >
            {armBusy ? '处理中…' : '保存'}
          </button>
        </div>
      </div>
    </>
  )
}
