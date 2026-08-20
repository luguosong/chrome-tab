package com.personal.newtab.changelog;

import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 更新日志代理：GET /api/changelog 返回 JSON（markdown + 最新版发布日期，ADR-0016）。
 *
 * <p>走 /api/** 统一鉴权（同源 cookie）。markdown 来自 GitHub 原文 + LLM 译制（ADR 0005），
 * 最近 N 版中文、旧版保留英文；releasedAt 来自 npm registry（{@link NpmReleaseDateService}），
 * 失败为 null → 前端日期行降级「—」。原文拉取失败抛异常 → GlobalExceptionHandler 500 → 前端重试。</p>
 */
@RestController
@RequestMapping("/api/changelog")
@RequiredArgsConstructor
public class ChangelogController {

    private final ChangelogService changelogService;
    private final NpmReleaseDateService npmReleaseDateService;

    /** markdown = 译制后的 CHANGELOG 全文；releasedAt = 最新版 npm 发布时间（ISO），可 null。 */
    public record ChangelogResponse(String markdown, String releasedAt) {
    }

    @GetMapping
    public ChangelogResponse get() {
        return new ChangelogResponse(changelogService.get(), npmReleaseDateService.latestReleaseDate());
    }
}
