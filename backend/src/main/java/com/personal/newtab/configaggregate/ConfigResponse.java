package com.personal.newtab.configaggregate;

import com.personal.newtab.navlink.NavLinkResponse;
import com.personal.newtab.setting.SettingResponse;
import com.personal.newtab.stockwatch.StockWatchResponse;

import java.util.List;

/**
 * 一次返回全部配置，省首屏多次往返。
 *
 * <p>expand 阶段：在旧字段 navLinks/stockWatches 之外<b>额外</b>返回 pages/icons，
 * 使旧前端继续可用、新前端可读取新模型。旧字段在 03 ticket 删除。</p>
 */
public record ConfigResponse(
        List<NavLinkResponse> navLinks,
        List<StockWatchResponse> stockWatches,
        List<PageResponse> pages,
        List<IconResponse> icons,
        SettingResponse setting) {
}
