// 目标页 URL 的读取与校验,newtab 与 popup 共用(ADR-0010)。
// 注意:本模块被 node --test 直接 import,顶层不得触碰 chrome 全局。

export const DEFAULT_TARGET_URL = 'http://localhost:5173';

// 校验目标页 URL:仅允许 http/https(信任边界,防 javascript: 等注入)。
// 合法返回归一化后的 href,非法返回 null。
export function validateTargetUrl(input) {
  if (typeof input !== 'string' || input.trim() === '') return null;
  let url;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  // 仅允许 http/https。这也拦住缺 scheme 的输入:"localhost:5173" 会被解析成协议名 localhost:
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return url.href;
}

// 读存储中的目标页 URL;未配置/被改坏/存储不可读时回退出厂默认。
export async function getTargetUrl() {
  try {
    const { targetUrl } = await chrome.storage.local.get('targetUrl');
    return validateTargetUrl(targetUrl) ?? DEFAULT_TARGET_URL;
  } catch {
    return DEFAULT_TARGET_URL;
  }
}
