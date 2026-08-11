/**
 * 给链接图标补全协议前缀(见 issue 09 / spec user story 22)。
 *
 * 新增抽屉里用户填写的网址可能是 "github.com" 裸域名,落库前统一补 https://。
 * 逻辑沿用 SearchBox 的 URL 分支(`v.startsWith('http') ? v : 'https://' + v`),
 * 抽出为纯函数以便 Vitest 断言与 AddDrawer 复用。
 *
 * 空串原样返回空(表单允许留空时由调用方决定是否阻止提交)。
 */
export function normalizeUrl(raw: string): string {
  const v = raw.trim()
  if (!v) return ''
  if (/^https?:\/\//i.test(v)) return v
  return `https://${v}`
}
