package com.personal.newtab.changelog;

import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 更新日志代理（ADR-0005 / ADR-0016 / ADR-0017）。
 *
 * <p>走 /api/** 统一鉴权（同源 cookie）。GET 纯读后端快照（6 小时定时预取 + 译文持久化，
 * ADR-0017），返回 markdown（最近 N 版中文、其余英文或已补译的中文）+ 最新版发布日期（npm，
 * ADR-0016）+ 已译版本号列表（前端据此对未译版本渲染「翻译」按钮）。
 * POST /translate 前端按需补译旧版本，译毕入库持久化，随后的 GET 即含新译文。</p>
 */
@RestController
@RequestMapping("/api/changelog")
@RequiredArgsConstructor
public class ChangelogController {

    private final ChangelogService changelogService;

    /** markdown = 拼装后全文；releasedAt = 最新版 npm 发布时间（ISO，可 null）；translatedVersions = 已译版本号。 */
    public record ChangelogResponse(String markdown, String releasedAt, List<String> translatedVersions) {
        static ChangelogResponse of(ChangelogService.Snapshot s) {
            return new ChangelogResponse(s.markdown(), s.releasedAt(), List.copyOf(s.translatedVersions()));
        }
    }

    /** versions = 要补译的版本号列表（前端 parseChangelog 的 title）。 */
    public record TranslateRequest(List<String> versions) {}

    @GetMapping
    public ChangelogResponse get() {
        return ChangelogResponse.of(changelogService.get());
    }

    /** 按需补译：指定版本缺失则译、入库，响应即最新全文（前端也可 invalidate 后重 GET）。 */
    @PostMapping("/translate")
    public ChangelogResponse translate(@RequestBody TranslateRequest request) {
        List<String> versions = request.versions() == null ? List.of() : request.versions();
        return ChangelogResponse.of(changelogService.translateVersions(versions));
    }
}
