package com.personal.newtab.layoutsetting;

import com.personal.newtab.configversion.ConfigVersionService;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 布局设置 upsert:有行则改,无行则建。范围校验由 {@link LayoutSettingRequest} 上的
 * jakarta 约束 + @Valid 触发,违反经 GlobalExceptionHandler → 400。
 * 写后 bump config_version(ADR-0006),使前端镜像据 updatedAt 和解。
 */
@Service
@RequiredArgsConstructor
public class LayoutSettingService {

    private final LayoutSettingRepository repository;
    private final ConfigVersionService configVersionService;

    @Transactional
    public LayoutSettingResponse update(Long userId, LayoutSettingRequest req) {
        LayoutSetting s = repository.findByUserId(userId).orElseGet(() -> {
            LayoutSetting n = new LayoutSetting();
            n.setUserId(userId);
            return n;
        });
        s.setGridWidth(req.gridWidth());
        s.setGridGap(req.gridGap());
        s.setGridGapY(orDefault(req.gridGapY(), LayoutLimits.GAP_Y_DEFAULT));
        s.setIconScale(req.iconScale());
        s.setPanelFog(orDefault(req.panelFog(), LayoutLimits.FOG_DEFAULT));
        s.setSearchBarWidth(orDefault(req.searchBarWidth(), LayoutLimits.SEARCH_WIDTH_DEFAULT));
        s.setSearchBarVisible(orDefault(req.searchBarVisible(), true));
        s.setSearchEngine(orDefault(req.searchEngine(), LayoutLimits.ENGINE_DEFAULT));
        s.setClockVisible(orDefault(req.clockVisible(), true));
        s.setClockFont(orDefault(req.clockFont(), LayoutLimits.CLOCK_FONT_DEFAULT));
        s.setClock24h(orDefault(req.clock24h(), true));
        s.setLabelVisible(orDefault(req.labelVisible(), true));
        s.setLabelSize(orDefault(req.labelSize(), LayoutLimits.LABEL_SIZE_DEFAULT));
        s.setLabelColor(orDefault(req.labelColor(), LayoutLimits.LABEL_COLOR_DEFAULT));
        LayoutSettingResponse resp = LayoutSettingResponse.of(repository.save(s));
        configVersionService.touch(userId);
        return resp;
    }

    /** 可空字段辅助:旧客户端只写三字段时落默认值。 */
    private static <T> T orDefault(T v, T def) {
        return v != null ? v : def;
    }

    /**
     * 布局设置请求体。gridWidth/gridGap/iconScale 为旧字段(必填,兼容不变);
     * 其余可空——旧客户端/旧备份(PUT /api/config 的 blob 也复用本记录)缺省时落
     * {@link LayoutLimits} 默认值。范围统一在 LayoutLimits。
     */
    public record LayoutSettingRequest(
            @NotNull @Min(LayoutLimits.WIDTH_MIN) @Max(LayoutLimits.WIDTH_MAX) Integer gridWidth,
            @NotNull @Min(LayoutLimits.GAP_MIN) @Max(LayoutLimits.GAP_MAX) Integer gridGap,
            @Min(LayoutLimits.GAP_Y_MIN) @Max(LayoutLimits.GAP_Y_MAX) Integer gridGapY,
            @NotNull @DecimalMin(LayoutLimits.SCALE_MIN) @DecimalMax(LayoutLimits.SCALE_MAX) Double iconScale,
            @Min(LayoutLimits.FOG_MIN) @Max(LayoutLimits.FOG_MAX) Integer panelFog,
            @Min(LayoutLimits.SEARCH_WIDTH_MIN) @Max(LayoutLimits.SEARCH_WIDTH_MAX) Integer searchBarWidth,
            Boolean searchBarVisible,
            @Pattern(regexp = "google|bing|baidu") String searchEngine,
            Boolean clockVisible,
            @Min(LayoutLimits.CLOCK_FONT_MIN) @Max(LayoutLimits.CLOCK_FONT_MAX) Integer clockFont,
            Boolean clock24h,
            Boolean labelVisible,
            @Min(LayoutLimits.LABEL_SIZE_MIN) @Max(LayoutLimits.LABEL_SIZE_MAX) Integer labelSize,
            @Pattern(regexp = "^#[0-9a-fA-F]{6}$") String labelColor) {
    }
}
