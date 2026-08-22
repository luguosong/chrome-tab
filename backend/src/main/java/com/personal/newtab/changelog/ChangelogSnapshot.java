package com.personal.newtab.changelog;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;

/**
 * 快照表实体(ADR-0017):单行({@link #SINGLE_ID}),原文全文 + npm 发布日期 + 拉取时间。
 * 原文是唯一事实源,译文按块哈希覆盖其上拼装;重启从本表恢复内存镜像,零 LLM 重译。
 * 列型显式声明以过生产 ddl-auto=validate,且双方言兼容:H2 MySQL 模式认 LONGTEXT 别名(→CLOB),
 * 498KB 原文超 TEXT 64KB 上限故必须 LONGTEXT(见 application-test.yml 约束)。
 */
@Entity
@Table(name = "changelog_snapshot")
@Getter @Setter
@NoArgsConstructor @AllArgsConstructor
public class ChangelogSnapshot {

    public static final int SINGLE_ID = 1;

    @Id
    private Integer id;

    /** CHANGELOG.md 原文全文(英文,未译)。LONGTEXT 显式列型对齐 V11 迁移(生产 ddl-auto=validate)。 */
    @Column(name = "raw_markdown", nullable = false, columnDefinition = "LONGTEXT")
    private String rawMarkdown;

    /** 最新版 npm 发布时间(ISO 串);拉取失败为 null,前端日期行降级「—」。 */
    @Column(name = "released_at", length = 64)
    private String releasedAt;

    @Column(name = "fetched_at", nullable = false)
    private LocalDateTime fetchedAt;
}
