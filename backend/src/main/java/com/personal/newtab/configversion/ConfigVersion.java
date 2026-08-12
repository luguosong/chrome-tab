package com.personal.newtab.configversion;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;

/**
 * 整体配置版本(ADR-0006):每用户一行。{@code updated_at} 由 {@link ConfigVersionService#touch}
 * 在任意配置写事务内显式赋值——不靠 DB 的 ON UPDATE,以换取与写事务原子、跨端可比、确定。
 *
 * <p>测试 profile 关 Flyway、用 ddl-auto=create-drop 从本实体生成 schema,故不依赖 MySQL 专有特性
 * (与 Icon/Page 一致:普通 DATETIME 列)。</p>
 */
@Entity
@Table(name = "config_version")
@Getter @Setter
@NoArgsConstructor @AllArgsConstructor
public class ConfigVersion {

    /** 即用户 id;每用户一行。无 @GeneratedValue——由代码按 userId upsert。 */
    @Id
    @Column(name = "user_id")
    private Long userId;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;
}
