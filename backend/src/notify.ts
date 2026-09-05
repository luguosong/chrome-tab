import { fetchText } from './common'

/**
 * ntfy 推送(ADR-0058「当天时效」触达外通道):自托管 ntfy 容器(compose 服务
 * ntfy,backend 内网直发),topic 即隐私边界(随机串,经 .env 注入)。未配置
 * (NTFY_URL/NTFY_TOPIC 缺)静默 no-op——通知是观测面,缺失不炸任何轮询;发送失败
 * 只记日志。仅推「本轮新增」事件(auto 已收录 / 新待人工线索),不重复打扰。
 */
export async function ntfyNotify(title: string, body: string, env: NodeJS.ProcessEnv): Promise<void> {
  const base = env.NTFY_URL ?? ''
  const topic = env.NTFY_TOPIC ?? ''
  if (base === '' || topic === '') return
  try {
    // title 走 query param(HTTP header 只收 ByteString,中文标题进 header 会抛)
    await fetchText(
      `${base.replace(/\/$/, '')}/${topic}?title=${encodeURIComponent(title)}`,
      10_000,
      {
        method: 'POST',
        body: `${body}\n${new Date().toISOString().slice(0, 16).replace('T', ' ')} 自动核验`,
      },
    )
  } catch (e) {
    console.warn('ntfy 推送失败:', e)
  }
}
