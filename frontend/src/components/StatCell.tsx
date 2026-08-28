/** 标签-值小格(横排,mono 值):股票估值行与天气实况/空气网格共用(原两文件
 *  逐字重复的局部组件,ADR-0040 批 2 提共享;服务器状态详情的 Stat 是纵排异构,
 *  不并入)。 */
export default function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-white/10 px-3 py-2">
      <span className="text-white/50">{label}</span>
      <span className="font-mono text-white/80">{value}</span>
    </div>
  )
}
