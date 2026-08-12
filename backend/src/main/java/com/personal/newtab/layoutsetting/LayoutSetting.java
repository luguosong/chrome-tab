package com.personal.newtab.layoutsetting;

import jakarta.persistence.*;
import lombok.*;

/**
 * 单用户的图标网格布局设置(CONTEXT.md「布局设置」)。一行一用户,user_id 即主键。
 * 三项像素几何:grid_width(网格最大宽度)、grid_gap(格子间距)、
 * icon_scale(favicon 像素与内边距同比系数)。与 8×8=64 格容量正交,不改格子数。
 * updated_at 由库管理(ON UPDATE CURRENT_TIMESTAMP),不在此映射。
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

    @Column(name = "icon_scale", nullable = false)
    private Double iconScale;
}
