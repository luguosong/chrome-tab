package com.personal.newtab.layoutsetting;

import com.personal.newtab.configversion.ConfigVersionService;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
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
        s.setIconScale(req.iconScale());
        LayoutSettingResponse resp = LayoutSettingResponse.of(repository.save(s));
        configVersionService.touch(userId);
        return resp;
    }

    /** 三项像素几何;范围统一在 {@link LayoutLimits}。 */
    public record LayoutSettingRequest(
            @NotNull @Min(LayoutLimits.WIDTH_MIN) @Max(LayoutLimits.WIDTH_MAX) Integer gridWidth,
            @NotNull @Min(LayoutLimits.GAP_MIN) @Max(LayoutLimits.GAP_MAX) Integer gridGap,
            @NotNull @DecimalMin(LayoutLimits.SCALE_MIN) @DecimalMax(LayoutLimits.SCALE_MAX) Double iconScale) {
    }
}
