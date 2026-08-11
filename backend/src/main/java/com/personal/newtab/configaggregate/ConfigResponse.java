package com.personal.newtab.configaggregate;

import com.personal.newtab.setting.SettingResponse;

import java.util.List;

/**
 * 一次返回全部配置，省首屏多次往返。
 *
 * <p>03 ticket 后：旧字段 navLinks/stockWatches 已删除，聚合接口只返回新模型
 * {pages, icons, setting}（见 ADR-0001）。</p>
 */
public record ConfigResponse(
        List<PageResponse> pages,
        List<IconResponse> icons,
        SettingResponse setting) {
}
