package com.personal.newtab.configaggregate;

import com.personal.newtab.configversion.ConfigVersionService;
import com.personal.newtab.icon.IconRepository;
import com.personal.newtab.layoutsetting.LayoutSettingRepository;
import com.personal.newtab.layoutsetting.LayoutSettingResponse;
import com.personal.newtab.page.PageRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 聚合读取装配:把 pages / icons / layoutSettings / config_version.updated_at 拼成 {@link ConfigResponse}。
 * GET /api/config 与 PUT /api/config(全量替换后回读)共用本装配,避免两处字段拼装漂移。
 */
@Component
@RequiredArgsConstructor
public class ConfigAssembler {

    private final PageRepository pageRepository;
    private final IconRepository iconRepository;
    private final LayoutSettingRepository layoutSettingRepository;
    private final ConfigVersionService configVersionService;

    public ConfigResponse read(Long userId) {
        var pages = pageRepository.findByUserIdOrderBySortOrderAscIdAsc(userId)
                .stream().map(PageResponse::of).toList();
        var icons = iconRepository.findByUserIdOrderByPageIdAscSortOrderAscIdAsc(userId)
                .stream().map(IconResponse::of).toList();
        var layout = layoutSettingRepository.findByUserId(userId)
                .map(LayoutSettingResponse::of)
                .orElseGet(LayoutSettingResponse::defaults);
        var updatedAt = configVersionService.getUpdatedAt(userId).orElse(null);
        return new ConfigResponse(pages, icons, layout, updatedAt);
    }
}
