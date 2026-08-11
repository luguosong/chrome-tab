package com.personal.newtab.configaggregate;

import com.personal.newtab.navlink.NavLinkResponse;
import com.personal.newtab.setting.SettingResponse;
import com.personal.newtab.stockwatch.StockWatchResponse;

import java.util.List;

/** 一次返回全部配置，省首屏多次往返。 */
public record ConfigResponse(
        List<NavLinkResponse> navLinks,
        List<StockWatchResponse> stockWatches,
        SettingResponse setting) {
}
