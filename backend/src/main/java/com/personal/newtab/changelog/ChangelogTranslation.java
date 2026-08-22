package com.personal.newtab.changelog;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;

/**
 * 译文表实体(ADR-0017):一行一个版本块,主键 = 块原文 SHA-256(hex)。
 * 永久保留——每版终身只译一次;定时预取与前端按需补译共用,命中即免译。
 */
@Entity
@Table(name = "changelog_translations")
@Getter @Setter
@NoArgsConstructor @AllArgsConstructor
public class ChangelogTranslation {

    /** 版本块原文 SHA-256 hex(64 位)。CHAR(64) 与 V11 迁移列型对齐(生产 ddl-auto=validate)。 */
    @Id
    @Column(name = "block_hash", columnDefinition = "CHAR(64)")
    private String blockHash;

    /** 该版本块的中文译文(含 {@code ##} 标题行,结构由系统提示约束保留)。 */
    @Column(nullable = false, columnDefinition = "TEXT")
    private String translated;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt = LocalDateTime.now();

    /** 写入用便利构造:created_at 取字段默认(当前时间)。 */
    public ChangelogTranslation(String blockHash, String translated) {
        this.blockHash = blockHash;
        this.translated = translated;
    }
}
