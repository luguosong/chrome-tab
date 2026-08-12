package com.personal.newtab.changelog;

import org.junit.jupiter.api.Test;

import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * ChangelogService 编排逻辑测试（见 ADR 0005 / TDD 接缝 2）。
 *
 * <p>不触网：fetcher / translator 用 lambda 桩注入。验证译制编排、哈希缓存与降级策略。</p>
 */
class ChangelogServiceTest {

    private static final String MD = "# Changelog\n\n## 1.0\n- hello\n\n## 2.0\n- world\n";

    /** 译制成功：前 n 版进切片被译制，拼回后整篇仍含后缀结构；第二次命中缓存不再译制。 */
    @Test
    void translatesFirstNVersionsAndReassembles() throws Exception {
        AtomicInteger translations = new AtomicInteger();
        ChangelogService service = new ChangelogService(
                () -> MD,
                slice -> {
                    translations.incrementAndGet();
                    return slice.replace("hello", "你好").replace("world", "世界");
                },
                2);

        String result = service.get();

        assertThat(result).contains("你好").contains("世界").contains("## 2.0");
        assertThat(result).startsWith("# Changelog\n\n");

        // 缓存命中：内容未变 → 复用，不再调用译制方
        service.get();
        assertThat(translations.get()).isEqualTo(1);
    }

    /** 译制方抛异常（LLM 宕机/网关错误）→ 透传英文原文，且不缓存（下次自动重试）。 */
    @Test
    void translatorThrows_degradesToRawEnglishUncached() throws Exception {
        AtomicInteger calls = new AtomicInteger();
        ChangelogService service = new ChangelogService(
                () -> MD,
                slice -> {
                    calls.incrementAndGet();
                    throw new RuntimeException("LLM 宕机");
                },
                2);

        assertThat(service.get()).isEqualTo(MD);
        service.get();   // 未缓存 → 再次尝试译制
        assertThat(calls.get()).isEqualTo(2);
    }

    /** 译制方返回 null（如未配置 API Key）→ 透传英文原文，且不缓存。 */
    @Test
    void translatorDeclinesByNull_degradesToRawUncached() throws Exception {
        AtomicInteger calls = new AtomicInteger();
        ChangelogService service = new ChangelogService(
                () -> MD,
                slice -> {
                    calls.incrementAndGet();
                    return null;
                },
                2);

        assertThat(service.get()).isEqualTo(MD);
        service.get();
        assertThat(calls.get()).isEqualTo(2);
    }

    /** 拉取原文失败（GitHub 不可达）→ 异常上抛，交由 GlobalExceptionHandler → 500，前端重试。 */
    @Test
    void fetcherThrows_propagatesAsServerError() {
        ChangelogService service = new ChangelogService(
                () -> { throw new RuntimeException("GitHub 不可达"); },
                slice -> "译",
                2);

        assertThatThrownBy(service::get).isInstanceOf(RuntimeException.class);
    }

    /** 上游内容变更（哈希不同）→ 失效旧缓存、重新译制并更新缓存。 */
    @Test
    void contentChanged_retranslatesAndUpdatesCache() throws Exception {
        AtomicInteger calls = new AtomicInteger();
        String a = "# Changelog\n\n## 1.0\n- alpha\n";
        String b = "# Changelog\n\n## 1.0\n- beta\n";
        String[] feed = {a, a, b, b};
        int[] idx = {0};
        ChangelogService service = new ChangelogService(
                () -> feed[Math.min(idx[0]++, feed.length - 1)],
                slice -> {
                    calls.incrementAndGet();
                    return slice.replace("alpha", "阿尔法").replace("beta", "贝塔");
                },
                1);

        assertThat(service.get()).contains("阿尔法");   // a 译制，calls=1
        assertThat(service.get()).contains("阿尔法");   // a 命中缓存
        assertThat(service.get()).contains("贝塔");      // b 新内容 → 重译，calls=2
        assertThat(service.get()).contains("贝塔");      // b 命中缓存
        assertThat(calls.get()).isEqualTo(2);
    }

    /**
     * 缓存键按「最近 N 版切片」哈希（ADR 0005），而非整篇原文。
     * 仅旧版本（切片之外）变更时：切片哈希不变 → 复用译文、不重译；但拼回用最新后缀，结果反映变更。
     */
    @Test
    void cacheKeyedBySlice_reusesTranslationWhenOnlySuffixChanges() throws Exception {
        AtomicInteger calls = new AtomicInteger();
        // translate-recent=1：切片 = 第 1 版；第 2 版落在后缀
        String a = "# Changelog\n\n## 1.0\n- new\n\n## 2.0\n- oldText\n";
        String b = "# Changelog\n\n## 1.0\n- new\n\n## 2.0\n- CHANGED\n";   // 切片同、后缀变
        int[] idx = {0};
        ChangelogService service = new ChangelogService(
                () -> (idx[0]++ == 0 ? a : b),
                slice -> {
                    calls.incrementAndGet();
                    return slice.replace("new", "新");
                },
                1);

        String r1 = service.get();   // 切片译制，calls=1
        String r2 = service.get();   // 切片哈希不变 → 复用译文，calls 仍=1

        assertThat(calls.get()).isEqualTo(1);
        assertThat(r1).contains("新").contains("oldText");
        assertThat(r2).contains("新").contains("CHANGED");   // 后缀用最新，不回退到 oldText
    }
}
