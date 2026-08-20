package com.personal.newtab.layoutsetting;

import jakarta.persistence.*;
import lombok.*;

/**
 * 单用户的仪表盘布局设置(CONTEXT.md「布局设置」,五组)。一行一用户,user_id 即主键。
 * 网格像素几何:grid_width(网格最大宽度)、grid_gap(横向间距)、grid_gap_y(竖向间距)、
 * icon_scale(favicon 像素与内边距同比系数)。页面外观:panel_fog(页板雾化浓度%)、
 * 搜索栏(search_bar_width/search_bar_visible/search_engine)、时钟(clock_visible/
 * clock_font/clock_24h)、图标名称(label_visible/label_size/label_color)。
 * 与 8×8=64 格容量正交,不改格子数。updated_at 由库管理,不在此映射。
 */
@Entity
@Table(name = "layout_settings")
@Getter @Setter
@NoArgsConstructor @AllArgsConstructor
public class LayoutSetting {

    @Id
    @Column(name = "user_id")
    private Long userId;

    @Column(name = "grid_width", nullable = false)
    private Integer gridWidth;

    @Column(name = "grid_gap", nullable = false)
    private Integer gridGap;

    @Column(name = "grid_gap_y", nullable = false)
    private Integer gridGapY;

    @Column(name = "icon_scale", nullable = false)
    private Double iconScale;

    @Column(name = "panel_fog", nullable = false)
    private Integer panelFog;

    @Column(name = "search_bar_width", nullable = false)
    private Integer searchBarWidth;

    @Column(name = "search_bar_visible", nullable = false)
    private Boolean searchBarVisible;

    /** 小写引擎 id(google/bing/baidu),与前端 LayoutSettings 直接对齐。 */
    @Column(name = "search_engine", nullable = false, length = 16)
    private String searchEngine;

    @Column(name = "clock_visible", nullable = false)
    private Boolean clockVisible;

    @Column(name = "clock_font", nullable = false)
    private Integer clockFont;

    @Column(name = "clock_24h", nullable = false)
    private Boolean clock24h;

    @Column(name = "label_visible", nullable = false)
    private Boolean labelVisible;

    @Column(name = "label_size", nullable = false)
    private Integer labelSize;

    @Column(name = "label_color", nullable = false, length = 7)
    private String labelColor;
}
