package com.personal.newtab.changelog;

import lombok.extern.slf4j.Slf4j;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;

/**
 * 更新日志译制编排（见 ADR 0005）。
 *
 * <p>流程：拉取原文 → 切最近 {@code translateRecent} 个版本 → 译制切片 → 拼回完整 markdown。
 * 译制失败（抛异常）或译制方拒绝（返回 null，如 Key 缺失）→ 记 warn 日志、透传英文原文。
 * <b>缓存键是「最近 N 版切片」的 SHA-256</b>（非整篇原文）：仅旧版本（切片之外）变更时切片哈希不变，
 * 复用译文、不重译；拼回时仍用最新后缀，结果反映变更。仅译制成功的结果入缓存。
 * 冷 miss 路径 {@code synchronized} 双检，避免并发首发触发多次 LLM 调用（thundering herd）。
 * IO 由两个注入的协作器承担，便于单测。</p>
 */
@Slf4j
public class ChangelogService {

    /** 拉取 CHANGELOG.md 原文。失败抛异常 → controller 层 500，前端走"刷新失败/重试"。 */
    @FunctionalInterface
    public interface MarkdownFetcher {
        String fetch() throws Exception;
    }

    /** 译制切片。返回 null 表示"不译制"（如未配置 Key）；抛异常表示译制失败。 */
    @FunctionalInterface
    public interface Translator {
        String translate(String markdownSlice) throws Exception;
    }

    /** 译文缓存条目：键=切片哈希，值=切片译文（不含前缀/后缀，拼回在调用方）。 */
    private record TranslationCache(String sliceHash, String translated) {}

    private final MarkdownFetcher fetcher;
    private final Translator translator;
    private final int translateRecent;

    private volatile TranslationCache cache;

    public ChangelogService(MarkdownFetcher fetcher, Translator translator, int translateRecent) {
        this.fetcher = fetcher;
        this.translator = translator;
        this.translateRecent = translateRecent;
    }

    public String get() {
        String raw;
        try {
            raw = fetcher.fetch();
        } catch (Exception e) {
            // 原文拉取失败（GitHub 不可达）→ 包成运行期异常上抛，GlobalExceptionHandler → 500，前端走"刷新失败/重试"
            throw new RuntimeException("拉取更新日志原文失败", e);
        }
        ChangelogSlicer.Slice slice = ChangelogSlicer.split(raw, translateRecent);
        String translated = translatedOf(slice);   // null = 降级
        return translated == null ? raw : slice.prefix() + translated + slice.suffix();
    }

    /** 取切片译文：命中缓存（按切片哈希）即复用，否则 synchronized 双检后译制并缓存。null 表示降级。 */
    private String translatedOf(ChangelogSlicer.Slice slice) {
        String sliceHash = sha256(slice.toTranslate());
        TranslationCache hit = cache;
        if (hit != null && hit.sliceHash().equals(sliceHash)) {
            return hit.translated();
        }
        synchronized (this) {
            hit = cache;   // 双检：并发首发中先获锁者已写入则直接复用
            if (hit != null && hit.sliceHash().equals(sliceHash)) {
                return hit.translated();
            }
            String translated;
            try {
                translated = translator.translate(slice.toTranslate());
            } catch (Exception e) {
                log.warn("更新日志译制失败，透传英文原文: {}", e.toString());
                return null;
            }
            if (translated == null) {
                log.warn("更新日志译制被拒绝（API Key 缺失？），透传英文原文");
                return null;
            }
            cache = new TranslationCache(sliceHash, translated);
            return translated;
        }
    }

    private static String sha256(String s) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(md.digest(s.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }
}
