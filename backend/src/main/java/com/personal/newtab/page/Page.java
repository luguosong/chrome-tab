package com.personal.newtab.page;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;

/**
 * 走马灯的固定画布（一屏）。是一等公民：用户可增/改名/排序/删。
 * 不映射 icons 关联——业务层通过 IconRepository 按 pageId 查询，
 * 避免 cascade 触发整页加载与 N+1。
 */
@Entity
@Table(name = "pages")
@Getter @Setter
@NoArgsConstructor @AllArgsConstructor
public class Page {

    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(name = "name", nullable = false, length = 64)
    private String name;

    @Column(name = "sort_order", nullable = false)
    private Integer sortOrder = 0;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt = LocalDateTime.now();
}
