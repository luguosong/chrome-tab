package com.personal.newtab.icon;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * 多态 Icon 表的实体（见 ADR-0001）。type 区分 nav/stock/changelog，
 * data 以 TEXT + JsonMapConverter 存 JSON（不用 MySQL 原生 JSON 类型，换 H2 方言一致）。
 */
@Entity
@Table(name = "icons")
@Getter @Setter
@NoArgsConstructor @AllArgsConstructor
public class Icon {

    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(name = "page_id", nullable = false)
    private Long pageId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private IconType type;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private Size size;

    @Column(name = "sort_order", nullable = false)
    private Integer sortOrder = 0;

    @Convert(converter = JsonMapConverter.class)
    @Column(columnDefinition = "TEXT")
    private Map<String, Object> data;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt = LocalDateTime.now();
}
