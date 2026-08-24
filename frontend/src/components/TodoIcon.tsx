import { useTodo } from '../hooks/useTodo'
import type { Icon } from '../lib/types'
import Tile, { TilePrimary, TileSecondary } from './Tile'

/**
 * 待办图标的专属网格渲染(见 CONTEXT.md「待办」):1×1,块内 = 未完成数(主行
 * mono)+ 最紧迫一条标题(次行截断,后端已按到期升序排好);下方名称行固定「待办」。
 * 加载中/取数失败/从未取到一律降级 ···(失败详情与重试入口在 Modal)。
 * 今日无待办显示 0 +「今日无事」。数据自持 useTodo;操作(点掉/速记)全归 Modal。
 */
export default function TodoIconBody({ icon, overlay = false }: { icon: Icon; overlay?: boolean }) {
  void icon // 单例无实例参数(data 无字段);保留形参对齐其它 body 的接口
  const { data } = useTodo()
  const tasks = data ?? []

  return (
    <Tile label="待办" overlay={overlay}>
      {data === undefined || data === null ? (
        <span className="text-white/40 text-sm leading-none">···</span>
      ) : (
        <>
          <TilePrimary className="font-mono text-white/90">{tasks.length}</TilePrimary>
          <TileSecondary className="text-white/60">
            {tasks.length === 0 ? '今日无事' : tasks[0].title}
          </TileSecondary>
        </>
      )}
    </Tile>
  )
}
