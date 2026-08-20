package com.personal.newtab.changelog;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.web.client.RestClient;

/**
 * npm registry 发布日期代理（ADR-0016）：CHANGELOG.md 原文的版本标题只有纯版本号、
 * 全文无任何日期，发布日期只能外取。拉 {@code @anthropic-ai/claude-code} 的完整
 * packument，取 {@code dist-tags.latest} 对应的 {@code time} 条目（即最新版发布时间，
 * ISO 串），供更新日志图标的日期行展示。
 *
 * <p>内存缓存 1 小时（volatile 双字段，够单实例低频读）；npm 不可达/响应畸形 → 记 warn、
 * 返回 null（前端日期行降级「—」），**不阻塞** markdown 主链路。否决备选见 ADR-0016：
 * GitHub commits API 的 CHANGELOG.md 最后提交时间只是版本日期的间接代理。</p>
 */
@Slf4j
public class NpmReleaseDateService {

    private static final long TTL_MS = 60 * 60 * 1000L;

    private final RestClient npm;

    private volatile String cachedAt;
    private volatile String releasedAt;

    public NpmReleaseDateService(@Qualifier("npmRegistryRestClient") RestClient npm) {
        this.npm = npm;
    }

    /** 最新版发布时间（ISO），失败/未取到返回 null。 */
    public String latestReleaseDate() {
        String now = java.time.Instant.now().toString();
        if (cachedAt != null && releasedAt != null
                && java.time.Duration.between(java.time.Instant.parse(cachedAt), java.time.Instant.parse(now)).toMillis() < TTL_MS) {
            return releasedAt;
        }
        String date = fetch();
        if (date != null) {
            cachedAt = now;
            releasedAt = date;
        }
        return date;
    }

    private String fetch() {
        try {
            JsonNode root = npm.get()
                    .uri("/@anthropic-ai/claude-code")
                    .retrieve()
                    .body(JsonNode.class);
            String latest = root.path("dist-tags").path("latest").asText(null);
            if (latest == null) return null;
            String date = root.path("time").path(latest).asText(null);
            return (date != null && !date.isBlank()) ? date : null;
        } catch (Exception e) {
            log.warn("拉取 npm 发布日期失败,日期行降级: {}", e.toString());
            return null;
        }
    }
}
