package com.personal.newtab.changelog;

import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 更新日志中文译制代理：GET /api/changelog 返回 markdown 文本（见 ADR 0005）。
 *
 * <p>走 /api/** 统一鉴权（同源 cookie）。内容来自 GitHub 原文 + aihubmix/gpt-5-nano 译制，
 * 最近 N 版中文、旧版保留英文；译制失败透传英文，原文拉取失败抛异常 → GlobalExceptionHandler 500 → 前端重试。</p>
 */
@RestController
@RequestMapping("/api/changelog")
@RequiredArgsConstructor
public class ChangelogController {

    private final ChangelogService changelogService;

    @GetMapping(produces = MediaType.TEXT_PLAIN_VALUE)
    public String get() {
        return changelogService.get();
    }
}
