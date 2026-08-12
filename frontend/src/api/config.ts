import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './client'
import type { Config, Icon, IconSize, IconTypeId, LayoutSettings, Page } from '../lib/types'
import { moveIcon, type MoveAction } from '../lib/iconReducer'
import type { WireConfig } from '../lib/mirror/backup'

/** Page 重排请求项(对齐后端 PageService.ReorderItem)。 */
export type ReorderItem = { id: number; sortOrder: number }

/**
 * 后端返回的原始聚合(JSON)。与 Config 不同处:icons 的 type/size 是大写枚举串
 * ("NAV"/"SMALL"…),这里镜像后端 wire format,normalize 后再交给 Config。
 */
type RawConfig = Omit<Config, 'icons'> & {
  icons: Array<{
    id: number
    pageId: number
    type: string
    size: string
    sortOrder: number
    data: Record<string, unknown> | null
  }>
}

/** 把后端大写枚举归一化为前端小写 id;未知值原样保留(扩展点:未来新增类型先这样降级)。 */
function normalizeIcon(i: RawConfig['icons'][number]): Icon {
  return {
    ...i,
    type: i.type.toLowerCase() as IconTypeId,
    size: i.size.toLowerCase() as IconSize,
  }
}

/** 后端原始聚合(大写枚举)→ 归一化 Config(小写)。useConfig 与 fetchConfigOnce 共用。 */
function normalizeConfig(raw: RawConfig): Config {
  return { ...raw, icons: raw.icons.map(normalizeIcon) }
}

/** 配置聚合：首屏一次取齐 pages/icons/layoutSettings;mutation 后 invalidate 重拉。 */
export function useConfig() {
  return useQuery<Config>({
    queryKey: ['config'],
    queryFn: async () => normalizeConfig(await apiFetch<RawConfig>('/api/config')),
  })
}

/** 一次性拉取并归一化(GET /api/config),不经 React Query。镜像和解 / 推送后回填用。 */
export async function fetchConfigOnce(): Promise<Config> {
  return normalizeConfig(await apiFetch<RawConfig>('/api/config'))
}

/**
 * 布局设置写:PUT /api/layout-settings body={gridWidth,gridGap,iconScale}。
 * 成功后 invalidate 聚合查询拉回权威值(跨设备共享语义)。实时预览由调用方乐观写
 * ['config'] 缓存实现(见 SettingsDrawer),本 hook 仅负责持久化。
 */
export function useUpdateLayoutSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: LayoutSettings) =>
      apiFetch<LayoutSettings>('/api/layout-settings', {
        method: 'PUT',
        body: JSON.stringify(vars),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['config'] }),
  })
}

/**
 * PUT /api/config 全量替换(ADR-0006):离线推送、导入「完全替换」与「合并」共用此端点。
 * 服务端整体重建并重排 id;成功后 invalidate 拉回权威数据。容量/单例/孤儿引用由服务端 409 把关。
 */
export function useReplaceConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: WireConfig) =>
      apiFetch<{ updatedAt?: string }>('/api/config', {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['config'] }),
  })
}

// ── Icon 写操作（issue 05 编辑模式:删除 / 改尺寸）──────────────────────────
// 乐观更新模式（react-query onMutate）:先改 ['config'].icons 到目标态,失败回滚快照,
// 完成后 invalidate 拉取权威数据。容量超限等约束由服务端 409 把关,前端乐观失败即回滚。

/** 前端小写 size → 后端大写枚举串(对齐 Jackson 默认枚举序列化,见后端 Size 枚举)。 */
function toWireSize(size: IconSize): string {
  return size.toUpperCase()
}

/** 删除图标:乐观从缓存移除,失败回滚。DELETE 返回 204 无体。 */
export function useDeleteIcon() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      apiFetch<void>(`/api/icons/${id}`, { method: 'DELETE' }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['config'] })
      const prev = qc.getQueryData<Config>(['config'])
      if (prev) {
        qc.setQueryData<Config>(['config'], {
          ...prev,
          icons: prev.icons.filter((i) => i.id !== id),
        })
      }
      return { prev }
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData<Config>(['config'], ctx.prev)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['config'] })
    },
  })
}

/** 改图标尺寸:乐观更新 size,失败回滚(容量超限由服务端 409 把关)。 */
export function useUpdateIconSize() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: number; size: IconSize }) =>
      apiFetch<void>(`/api/icons/${vars.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ size: toWireSize(vars.size) }),
      }),
    onMutate: async ({ id, size }) => {
      await qc.cancelQueries({ queryKey: ['config'] })
      const prev = qc.getQueryData<Config>(['config'])
      if (prev) {
        qc.setQueryData<Config>(['config'], {
          ...prev,
          icons: prev.icons.map((i) => (i.id === id ? { ...i, size } : i)),
        })
      }
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData<Config>(['config'], ctx.prev)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['config'] })
    },
  })
}

/**
 * 改图标配置(data):乐观更新 icons[i].data,失败回滚。对齐 {@link useUpdateIconSize}
 * 的 onMutate 模式。后端 PATCH /api/icons/{id} body={data}(部分更新:size 不传则不动)。
 * 编辑模式 ✎ 入口用。data 归一化(url 补 https://)由调用方经 buildIconData 完成。
 */
export function useUpdateIconData() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: number; data: Record<string, unknown> | null }) =>
      apiFetch<void>(`/api/icons/${vars.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ data: vars.data }),
      }),
    onMutate: async ({ id, data }) => {
      await qc.cancelQueries({ queryKey: ['config'] })
      const prev = qc.getQueryData<Config>(['config'])
      if (prev) {
        qc.setQueryData<Config>(['config'], {
          ...prev,
          icons: prev.icons.map((i) => (i.id === id ? { ...i, data } : i)),
        })
      }
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData<Config>(['config'], ctx.prev)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['config'] })
    },
  })
}

// ── Page 写操作（issue 08 页面管理:新建 / 改名 / 删除 / 重排）─────────────────
// 新建/改名/删除走 invalidate-on-success(离散动作,服务端分配 id/校验非空页 409);
// 重排走乐观更新(拖拽视觉跟随,失败回滚),与 Icon 写操作同一套 onMutate 模式。
// 服务端契约:POST 返回 200(非 201);DELETE 非空页返回 409 {status,message}。

/** 新建页:POST /api/pages body={name} → 200 {id,name,sortOrder}。成功后 invalidate。 */
export function useCreatePage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) =>
      apiFetch<Page>('/api/pages', {
        method: 'POST',
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['config'] }),
  })
}

/** 改名页:PUT /api/pages/{id} body={name} → 200。成功后 invalidate。 */
export function useRenamePage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: number; name: string }) =>
      apiFetch<Page>(`/api/pages/${vars.id}`, {
        method: 'PUT',
        body: JSON.stringify({ name: vars.name }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['config'] }),
  })
}

/**
 * 删除页:DELETE /api/pages/{id} → 204(空页)/ 409(非空页,message 指示先移走图标)。
 * 不做乐观更新:非空页 409 时调用方据 onError 的 ApiError.message 显示提示。
 */
export function useDeletePage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      apiFetch<void>(`/api/pages/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['config'] }),
  })
}

/**
 * 重排页:PATCH /api/pages/reorder body=[{id,sortOrder}] → 200 全量页列表。
 * 乐观更新:立即按新顺序排好 ['config'].pages,失败回滚,完成后 invalidate 兜底。
 */
export function useReorderPages() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (items: ReorderItem[]) =>
      apiFetch<Page[]>('/api/pages/reorder', {
        method: 'PATCH',
        body: JSON.stringify(items),
      }),
    onMutate: async (items) => {
      await qc.cancelQueries({ queryKey: ['config'] })
      const prev = qc.getQueryData<Config>(['config'])
      if (prev) {
        const order = new Map(items.map((it) => [it.id, it.sortOrder]))
        const pages = [...prev.pages].sort(
          (a, b) =>
            (order.get(a.id) ?? a.sortOrder) - (order.get(b.id) ?? b.sortOrder),
        )
        qc.setQueryData<Config>(['config'], { ...prev, pages })
      }
      return { prev }
    },
    onError: (_err, _items, ctx) => {
      if (ctx?.prev) qc.setQueryData<Config>(['config'], ctx.prev)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['config'] })
    },
  })
}

// ── Icon 新建(issue 09 新增抽屉)──────────────────────────────────────────

/** POST /api/icons 新建图标请求体。type/size 为前端小写 id,在 mutation 内转大写。 */
export type CreateIconBody = {
  pageId: number
  type: IconTypeId
  size: IconSize
  data: Record<string, unknown> | null
}

/**
 * 新建图标(spec §后端 API 契约 / issue 09)。type/size 在请求边界转大写对齐后端枚举,
 * 成功后失效聚合查询使新图标即时出现在当前页末尾。容量超限/单例重复由服务端返回 409,
 * 抛 {@link ApiError};由 AddDrawer 转译为用户提示("此页已满…")。
 */
export function useCreateIcon() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateIconBody) =>
      apiFetch<unknown>('/api/icons', {
        method: 'POST',
        body: JSON.stringify({
          pageId: body.pageId,
          type: body.type.toUpperCase(),
          size: toWireSize(body.size),
          data: body.data,
        }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['config'] }),
  })
}

// ── Icon 移动/重排（issue 06 同页拖拽排序）─────────────────────────────────

/**
 * 移动/重排图标(spec §后端 API 契约 / issue 06)。body=`{id, toPageId, toIndex}`,
 * 同页与跨页统一端点;本票仅消费同页(toPageId === 图标当前 pageId)。
 *
 * 乐观更新复用纯 reducer {@link moveIcon}:onMutate 即把 ['config'].icons 推到目标态,
 * 拖拽视觉即时跟随;失败回滚快照,完成后 invalidate 兜底。容量约束由服务端在跨页
 * 场景把关(同页纯重排不触发容量校验,占用不变)。
 */
export function useMoveIcon() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: MoveAction) =>
      apiFetch<void>('/api/icons/move', {
        method: 'PATCH',
        body: JSON.stringify(vars),
      }),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: ['config'] })
      const prev = qc.getQueryData<Config>(['config'])
      if (prev) {
        qc.setQueryData<Config>(['config'], { ...prev, icons: moveIcon(prev.icons, vars) })
      }
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData<Config>(['config'], ctx.prev)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['config'] })
    },
  })
}
