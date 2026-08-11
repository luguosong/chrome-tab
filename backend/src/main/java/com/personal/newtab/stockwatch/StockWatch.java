package com.personal.newtab.stockwatch;

import jakarta.persistence.*;
import lombok.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "stock_watches")
@Getter @Setter
@NoArgsConstructor @AllArgsConstructor
public class StockWatch {

    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(nullable = false, length = 16)
    private String symbol;          // usAAPL / sh600519 等，对齐腾讯 qt.gtimg.cn

    @Column(nullable = false, length = 64)
    private String name;

    @Column(name = "group_name", nullable = false, length = 32)
    private String groupName;

    @Column(name = "sort_order", nullable = false)
    private Integer sortOrder = 0;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt = LocalDateTime.now();

    /** symbol 前缀 → 分组：us 美股/指数，sh/sz A 股。DataBootstrap 与 Controller 共用 */
    public static String groupOf(String symbol) {
        return symbol != null && symbol.startsWith("us") ? "美股/指数" : "A股";
    }
}
