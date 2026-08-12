package com.personal.newtab.wallpaper;

/**
 * 必应每日壁纸代理响应。
 *
 * @param url      完整图片 URL（已拼好 https://www.bing.com 前缀与 1920x1080 分辨率）
 * @param copyright 图片版权/描述文案
 * @param date    必应 enddate（yyyyMMdd）
 */
public record WallpaperResponse(String url, String copyright, String date) {
}
