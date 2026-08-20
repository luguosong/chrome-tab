import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { get, type EditorField, type IconTypeDefinition } from '../lib/iconTypeRegistry'
import StockIconBody from './StockIcon'
import WeatherIconBody from './WeatherIcon'
import ChangelogIconBody from './ChangelogIcon'
import LocationPicker from './LocationPicker'
import type { Icon as IconModel } from '../lib/types'
import { useEditMode } from '../context/EditModeContext'
import { useGroupGesture } from '../context/GroupGestureContext'
import { useLayoutSettings } from '../context/LayoutSettingsContext'
import { faviconPx } from '../lib/iconLayout'
import { extractString, buildIconData, faviconUrl } from '../lib/iconData'
import { groupMembers } from '../lib/groupReducer'
import { readWeatherLocation, type WeatherLocation } from '../lib/weather'
import { useConfig, useDeleteIcon, useDissolveGroup, useUpdateIconData } from '../api/config'
import { ApiError } from '../api/client'

/**
 * 单个图标渲染(见 CONTEXT.md「图标」/ spec §前端架构 IconGrid / ADR-0012 图标层换肤)。
 *
 * 所有图标一律占 1 格(ADR-0016 单档化)。视觉按类型分派(ADR-0015 容器分层:
 * nav/分组的外壳即本组件 Tag,小组件沿用既有卡):
 *   - nav:favicon 居中块内(边长 = faviconPx),名称外置图标下方(iOS 主屏式),
 *     hover/active 轻缩放作反馈
 *   - group:iOS 文件夹式——块内成员 favicon 3×2 迷你预览(GroupBody,ADR-0011)
 *   - stock / weather / changelog:专属小组件 body(StockIcon / WeatherIcon / ChangelogIcon,
 *     单档极简密度),body 左对齐铺满块
 *
 * 点击行为(按 detail 字段派发 —— ADR-0001 契约:容器形态由类型定义声明,
 * 新增复用 modal/drawer 的类型无需改本组件):
 *   - 编辑模式:不触发任何详情/跳转(角标操作优先,spec user story 29)
 *   - detail='none':nav 渲染为 <a>(新标签打开目标 URL,spec user story 13)
 *   - detail='modal'/'drawer':查看态点击 → onOpenDetail(icon),父组件按 detail 渲染面板
 *
 * 拖拽(06):本组件是网格画格(grid item),故 useSortable 直接挂在此处。
 * 查看模式与编辑模式均可拖。激活策略由 DashboardPage 的 Mouse/TouchSensor 决定(鼠标移动即拖、
 * 触控长按拖),点击(轻点)因激活阈值/延迟与拖拽分流,链接/详情照常打开。attributes 仅在
 * 编辑模式注入(保留 nav `<a>` 原生 role=link 语义与无障碍行为),listeners 在两种模式都注入。
 * data 带 pageId 供 DndContext handler 读取(跨页 07 用)。
 * 编辑模式角标(EditActions)的交互按钮 onPointerDown stopPropagation,避免点角标误启拖拽。
 */
/** 小组件卡内边距(原 Tailwind p-* 的 px 值),乘 iconScale 得实际值。 */
const WIDGET_PAD_PX = 8

/**
 * 图标名称(见 CONTEXT.md「图标名称」):外置块下方的一行文字,iOS 主屏式——
 * 普通图标与「分组」共用。样式(显隐/字号/颜色)来自「布局设置」,显隐全局生效
 * (编辑模式同样隐藏,不设特殊分支);shrink-0 保证行高不被压缩。
 */
function IconLabel({ name }: { name: string }) {
  const { labelVisible, labelSize, labelColor } = useLayoutSettings()
  if (!labelVisible) return null
  return (
    <span
      className="shrink-0 max-w-full truncate text-center"
      style={{ fontSize: labelSize, color: labelColor }}
    >
      {name}
    </span>
  )
}

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
  const { editing } = useEditMode()
  const { iconScale } = useLayoutSettings()
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

  // 拖拽(06):查看模式与编辑模式均启用;data 带 pageId 供 DndContext handler 读取(见 issue 06 checklist)。
  // overlay 副本强制 disabled,避免在 DragOverlay(脱离 SortableContext)里重复注册可拖节点。
  // 点击与拖拽的分流由 DashboardPage 的 Mouse/TouchSensor 激活策略负责(鼠标移动即拖、触控长按)。
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: icon.id,
    data: { pageId: icon.pageId },
    disabled: overlay,
  })

  const padPx = WIDGET_PAD_PX * iconScale
  // favicon 边长(ADR-0016 单档):基准 32 × iconScale。
  const favPx = faviconPx(iconScale)

  // 小组件类型(stock/weather/changelog):专属 body 左对齐铺满;nav/group 内容居中。
  const isWidget = icon.type === 'stock' || icon.type === 'weather' || icon.type === 'changelog'

  const style: CSSProperties = {
    // padding 只给小组件卡(卡内即全部内容);nav/group 的玻璃块在图标层(TileFrame,
    // 只包 favicon/预览),名称在块外画格上(iOS 主屏式:块=图标本体,文字=壁纸层)。
    padding: isWidget ? padPx : 0,
    // 拖拽变换仅作用于网格内本体(06);overlay 幽灵由 DragOverlay 负责定位,不重复套 transform。
    ...(!overlay
      ? {
          transform: CSS.Transform.toString(transform),
          transition,
          ...(isDragging ? { opacity: 0.4, zIndex: 20 } : null),
        }
      : null),
  }

  const name = extractString(icon.data, 'name')
  const url = icon.type === 'nav' ? extractString(icon.data, 'url') : ''
  const favicon = url ? faviconUrl(url) : ''

  // 点击派发(ADR-0001 契约:容器形态由类型定义声明):
  //   - group:点开分组弹层(票 08)——任意模式(编辑态也要先开弹层才能组内排序)
  //   - 其余类型:编辑模式一律不触发;查看模式按 detail 字段
  //     - detail='none':nav 渲染为 <a target=_blank> 新标签打开(保留原生中键/右键菜单)
  //     - detail='modal'/'drawer':点击 → onOpenDetail,由父组件按 detail 渲染对应面板
  const isNavLink = icon.type === 'nav' && !editing
  const Tag = isNavLink ? 'a' : 'div'
  const linkProps = isNavLink
    ? { href: url, target: '_blank' as const, rel: 'noreferrer' }
    : {}
  const hasPanel = def?.detail === 'modal' || def?.detail === 'drawer'
  // 组图标点击 = 开弹层(票 08):任意模式(编辑态开弹层才能组内排序),不与编辑态互斥
  const onGroupOpen = icon.type === 'group' && onOpenGroup ? () => onOpenGroup(icon) : undefined
  const onClick =
    onGroupOpen ??
    (!editing && hasPanel && onOpenDetail ? () => onOpenDetail(icon) : undefined)

  const interactive = isNavLink || onClick !== undefined

  return (
    <Tag
      ref={overlay ? undefined : setNodeRef}
      style={style}
      {...linkProps}
      {...(editing && !overlay ? attributes : {})}
      {...(overlay ? {} : listeners)}
      onClick={onClick}
      title={def?.label}
      className={
        'relative flex flex-col transition ' +
        // 小组件类型:soft 玻璃卡容器(ADR-0012,hover 提亮在 .glass-soft 自身规则里),
        // 单档一律 2xl 圆角;body 左对齐铺满。
        // [container-type:size]:作容器查询的查询容器(画格高度随视口缩放,body 按卡高
        // 自适应;size containment 对 grid item 无布局影响——高度由轨道定,不依赖内容)。
        // 不能加 overflow-hidden:编辑角标定位在卡外。
        // nav/group:画格透明,玻璃块在图标层(TileFrame)——块只包图标本身(ADR-0015b),
        // 名称外置块下方(iOS 主屏式)。
        (isWidget
          ? 'glass-soft items-stretch justify-center gap-1 text-left [container-type:size] rounded-2xl '
          : 'items-center justify-center gap-1 ') +
        (interactive ? 'cursor-pointer' : 'cursor-default') +
        // 合并手势达标放大(dwell):目标非被拖项、无 dnd transform 冲突;transition 已有
        (dwellTarget === icon.id && !overlay ? ' scale-[1.15] z-10 ' : '') +
        (editing && !overlay ? ' editing-jiggle cursor-grab active:cursor-grabbing' : '') +
        (isDragging && !overlay ? ' ring-2 ring-accent' : '') +
        (overlay ? ' shadow-2xl ring-2 ring-accent cursor-grabbing' : '')
      }
    >
      {icon.type === 'stock' ? (
        <StockIconBody icon={icon} />
      ) : icon.type === 'weather' ? (
        <WeatherIconBody icon={icon} />
      ) : icon.type === 'group' ? (
        /* 分组(ADR-0011,ADR-0015 容器化):iOS 文件夹式——玻璃块内成员 favicon 迷你预览,
           名称外置下方。点组打开弹层看全部成员 = 票 08。 */
        <>
          <GroupBody icon={icon} favPx={favPx} overlay={overlay} />
          {name && <IconLabel name={name} />}
        </>
      ) : icon.type === 'changelog' ? (
        <ChangelogIconBody icon={icon} />
      ) : (
        <>
          {/* nav:玻璃 squircle 块 = 图标本体(ADR-0015 修订:玻璃下沉到图标层,只包
              favicon,名称外置块下方),favicon 撑满块(pad=0,图形即块)。 */}
          {favicon && (
            <TileFrame favPx={favPx} overlay={overlay}>
              <img
                src={favicon}
                alt=""
                referrerPolicy="no-referrer"
                className="w-full h-full rounded-[22%] object-contain"
              />
            </TileFrame>
          )}

          {/* 名称:外置图标下方(iOS 主屏式),样式见 IconLabel。 */}
          {name && <IconLabel name={name} />}
        </>
      )}

      {/* 分组解散失败提示(容量 409「先移出部分图标」等):组图标上方小气泡,短暂显示 */}
      {icon.type === 'group' && dissolve.isError && (
        <span className="absolute -top-9 left-1/2 -translate-x-1/2 z-40 glass-panel rounded-full px-3 py-1 text-[11px] text-white/90 whitespace-nowrap shadow-lg pointer-events-none">
          {dissolve.error instanceof ApiError ? dissolve.error.message : '解散失败'}
        </span>
      )}

      {/* 编辑模式角标:编辑配置 ✎ + 删除 ×(spec user story 27/28;尺寸切换已随
          ADR-0016 单档化移除)。× 点击 DELETE,乐观更新 + 失败回滚见 api/config.ts。
          stopPropagation 避免冒泡到 Tag。overlay 幽灵不渲染角标(拖拽副本不带交互控件)。 */}
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
 * 图标本体玻璃块(ADR-0015 修订):squircle 玻璃容器即图标本体——favicon 撑满块
 * (pad=0,块边 = faviconPx 推导值,图形即块,iOS app 图标式);分组预览等嵌套内容
 * 可传小 pad 呼吸。名称在块外画格上(iOS 主屏层级:块=图标本体,文字=壁纸层)。
 * 块边 = min(推导值, 画格可用高度)——maxWidth/maxHeight 双上限 + aspect-square 与
 * favicon 时代的收缩机制同款(同档位画格等高,收缩全体一致);overlay 幽灵无画格约束
 * (shrink-wrap),固定推导值。hover/active 缩放作用于**整块**(图形随块,iOS 无溢出
 * 裁切问题),提亮由 .glass-soft 自身规则承担(ADR-0012)。
 */
function TileFrame({
  favPx,
  padPx = 0,
  overlay,
  className = '',
  children,
}: {
  favPx: number
  padPx?: number
  overlay: boolean
  className?: string
  children: ReactNode
}) {
  const bound = favPx + padPx * 2
  return (
    <div
      className={
        'glass-soft rounded-[22%] ' +
        (!overlay
          ? 'flex-1 min-h-0 aspect-square transition-transform hover:scale-110 active:scale-95 '
          : '') +
        className
      }
      style={
        overlay
          ? { width: bound, height: bound, padding: padPx }
          : { maxWidth: bound, maxHeight: bound, padding: padPx }
      }
    >
      {children}
    </div>
  )
}

/**
 * 分组图标内容(ADR-0011,ADR-0015 修订):iOS 文件夹式——玻璃块(TileFrame)内
 * 3×2 网格,按组内序取**前 6 个**成员的 favicon(不足留空)。取 3×2 而非 iOS 原版
 * 3×3:块受画格高度所限(正方形块 ~48px),3×3 每子仅约 10px 不可辨认,3×2 每子
 * 约 19px 是辨认下限;块内 pad 用小固定值(3px,不随 scale),为子图标争取空间
 * (iOS 文件夹块内边距同样小于 app 图标)。
 * 成员从聚合缓存按 parentId 派生(groupMembers)。
 * 在组件内(而非 Icon 主体)调 useConfig:仅 group 类型挂载时才订阅,['config'] 命中缓存
 * 无网络开销;overlay 拖拽幽灵同路径渲染(React 上下文随 React 树,不随 DOM)。
 */
function GroupBody({
  icon,
  favPx,
  overlay,
}: {
  icon: IconModel
  favPx: number
  overlay: boolean
}) {
  const { data } = useConfig()
  const members = useMemo(
    () => groupMembers(data?.icons ?? [], icon.id).slice(0, 6),
    [data?.icons, icon.id],
  )
  return (
    <TileFrame favPx={favPx} padPx={3} overlay={overlay}>
      <div className="grid w-full h-full grid-cols-3 grid-rows-2 place-items-center gap-[6%]">
        {members.map((m) => {
          // 组成员只能是 nav(后端把关),但防御式兜底非 nav/无 url 的占位灰块
          const url = m.type === 'nav' ? extractString(m.data, 'url') : ''
          const src = url ? faviconUrl(url) : ''
          return src ? (
            <img
              key={m.id}
              src={src}
              alt=""
              referrerPolicy="no-referrer"
              className="w-full h-full rounded-[2px] object-contain"
            />
          ) : (
            <span key={m.id} className="w-full h-full rounded-[2px] bg-white/20" />
          )
        })}
      </div>
    </TileFrame>
  )
}

/**
 * 编辑模式角标集群(右上角):编辑配置 ✎ + 删除 ×。
 * (尺寸切换菜单已随 ADR-0016 单档化移除。)
 * 所有点击 stopPropagation,避免冒泡到图标 Tag(编辑态 Tag 本就无 onClick,纯防御)。
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
  // 仅 editor 非空的类型(nav/stock/weather)出现编辑配置 ✎;changelog(editor=[])无配置可改。
  const editor = def?.editor ?? []
  const showEdit = editor.length > 0
  return (
    <>
      <div
        className="absolute -top-2 -right-2 z-20 flex gap-1"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* 编辑配置 ✎:打开 popover(字段预填) */}
        {showEdit && (
          <button
            type="button"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation()
              setEditOpen(!editOpen)
            }}
            onContextMenu={(e) => e.stopPropagation()}
            className="glass-panel w-6 h-6 rounded-full text-[11px] leading-none text-white/90 flex items-center justify-center hover:bg-white/40 disabled:opacity-50"
            title="编辑"
          >
            ✎
          </button>
        )}
        {/* 删除 × */}
        <button
          type="button"
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          onContextMenu={(e) => e.stopPropagation()}
          className="w-6 h-6 rounded-full bg-accent text-white text-sm leading-none flex items-center justify-center hover:bg-accent/80 disabled:opacity-50"
          title="删除"
        >
          ×
        </button>
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
 * 编辑配置 popover(见 CONTEXT.md「编辑模式」)。从图标当前 data 预填类型 editor 声明的字段
 * (nav=name+url / stock=symbol+name),保存走 useUpdateIconData(PATCH /api/icons/{id} body={data}),
 * 取消直接关闭。与 AddDrawer 共用 buildIconData 归一化 + 输入样式,使「新增」与「编辑」表单一致。
 *
 * 容器用 `fixed inset-0` 透明遮罩(z-30,click-outside 取消)+ absolute 面板(z-40)。
 * onPointerDown stopPropagation 防止冒泡到 Tag 触发拖拽(同 EditActions 角标,见 06)。
 */
function EditForm({
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
  // location 字段(天气)是结构化对象,预填 readWeatherLocation;其余为字符串。
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(
      fields.map((f) => [
        f.name,
        f.name === 'location' ? (readWeatherLocation(icon.data) ?? '') : extractString(icon.data, f.name),
      ]),
    ),
  )
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
        className="fixed inset-0 z-30 cursor-default"
      />
      <div
        className="absolute top-5 right-0 z-40 glass-panel rounded-lg p-2 min-w-[200px] space-y-2"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {fields.map((f) =>
          f.name === 'location' ? (
            <LocationPicker
              key={f.name}
              value={values[f.name] ? (values[f.name] as WeatherLocation) : null}
              onChange={(loc) => setField('location', loc)}
              placeholder={f.placeholder}
            />
          ) : (
            <input
              key={f.name}
              value={(values[f.name] as string) ?? ''}
              onChange={(e) => setField(f.name, e.target.value)}
              placeholder={f.placeholder}
              aria-label={f.label}
              className="w-full px-2.5 py-1.5 rounded-md bg-white/20 text-white placeholder-white/50 text-xs outline-none focus:ring-2 focus:ring-accent"
            />
          ),
        )}
        <div className="flex gap-2 justify-end pt-0.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onCancel()
            }}
            className="px-2 py-1 rounded-md text-xs text-white/80 hover:bg-white/20"
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation()
              onSave(buildIconData(fields, values))
            }}
            className="px-2.5 py-1 rounded-md bg-accent/90 hover:bg-accent disabled:opacity-50 text-white text-xs"
          >
            保存
          </button>
        </div>
      </div>
    </>
  )
}
