package com.personal.newtab.configaggregate;

import com.personal.newtab.layoutsetting.LayoutSettingResponse;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 一次返回全部配置，省首屏多次往返。
 *
 * <p>03 ticket 后：旧字段 navLinks/stockWatches 已删除；深色主题改造后 setting 字段
 * 亦移除。布局设置(显示几何)经 layoutSettings 字段下发(见 CONTEXT.md「布局设置」)。
 * updatedAt 为整体配置版本(config_version,见 ADR-0006):任意配置写前进,前端镜像据此与服务端 LWW。</p>
 */
public record ConfigResponse(
        List<PageResponse> pages,
        List<IconResponse> icons,
        LayoutSettingResponse layoutSettings,
        LocalDateTime updatedAt) {
}
