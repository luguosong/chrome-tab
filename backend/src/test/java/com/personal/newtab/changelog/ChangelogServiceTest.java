package com.personal.newtab.changelog;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * ChangelogService 编排逻辑测试（见 ADR 0005 / ADR-0017）。
 *
 * <p>不触网：fetcher / translator 用 lambda 桩注入，两个仓库 + npm 日期服务用 Map 桩 Mockito mock
 * （save → put，findByBlockHashIn → 按键捞）。验证增量译制（逐块哈希比对、只译缺失）、
 * 快照持久化与重启恢复（零 LLM）、按需补译与降级策略。</p>
 */
class ChangelogServiceTest {

    private static final String RAW = "# Changelog\n\n## 3.0\n- three\n\n## 2.0\n- two\n\n## 1.0\n- one\n";

    /** 逐块桩:每块恰好含一个关键词,译制 = 关键词换中文。 */
    private static final ChangelogService.Translator TRANSLATOR = block -> {
        if (block.contains("three")) return block.replace("three", "三");
        if (block.contains("two")) return block.replace("two", "二");
        if (block.contains("one")) return block.replace("one", "一");
        if (block.contains("four")) return block.replace("four", "四");
        throw new IllegalStateException("未知块: " + block);
    };

    private final Map<String, String> translationDb = new ConcurrentHashMap<>();
    private ChangelogSnapshot snapshotRow;
    private ChangelogTranslationRepository translations;
    private ChangelogSnapshotRepository snapshots;

    @BeforeEach
    void setUp() {
        translations = mock(ChangelogTranslationRepository.class);
        when(translations.findByBlockHashIn(anyCollection())).thenAnswer(inv -> {
            @SuppressWarnings("unchecked")
            var hashes = (java.util.Collection<String>) inv.getArgument(0);
            return hashes.stream().filter(translationDb::containsKey)
                    .map(h -> new ChangelogTranslation(h, translationDb.get(h)))
                    .toList();
        });
        when(translations.save(any())).thenAnswer(inv -> {
            ChangelogTranslation t = inv.getArgument(0);
            translationDb.put(t.getBlockHash(), t.getTranslated());
            return t;
        });
        snapshots = mock(ChangelogSnapshotRepository.class);
        when(snapshots.findById(ChangelogSnapshot.SINGLE_ID))
                .thenAnswer(inv -> Optional.ofNullable(snapshotRow));
        when(snapshots.save(any())).thenAnswer(inv -> {
            snapshotRow = inv.getArgument(0);
            return snapshotRow;
        });
    }

    private ChangelogService service(ChangelogService.MarkdownFetcher fetcher,
                                     ChangelogService.Translator translator,
                                     int translateRecent) {
        NpmReleaseDateService npm = mock(NpmReleaseDateService.class);
        when(npm.fetchLatestReleaseDate()).thenReturn(null);
        return new ChangelogService(fetcher, translator, translations, snapshots, npm, translateRecent);
    }

    /** 首轮:只译最近 N 版(哈希缺失的块),快照落库,translatedVersions 反映已译集合。 */
    @Test
    void coldGet_translatesRecentNPersistsSnapshot() {
        ChangelogService s = service(() -> RAW, TRANSLATOR, 2);

        ChangelogService.Snapshot snap = s.get();

        assertThat(snap.markdown()).contains("三").contains("二").contains("- one");   // 1.0 窗口外保持英文
        assertThat(snap.translatedVersions()).containsExactly("3.0", "2.0");
        assertThat(translationDb).hasSize(2);
        assertThat(snapshotRow.getRawMarkdown()).isEqualTo(RAW);
        assertThat(snapshotRow.getReleasedAt()).isNull();   // npm 失败 → null,不阻塞
    }

    /** 同一原文再次刷新:全部块哈希命中 → 零 LLM 调用。 */
    @Test
    void refreshAgain_sameRaw_zeroLlmCalls() {
        AtomicInteger calls = new AtomicInteger();
        ChangelogService.Translator counting = block -> {
            calls.incrementAndGet();
            return TRANSLATOR.translate(block);
        };
        ChangelogService s = service(() -> RAW, counting, 2);

        s.get();
        s.refresh();   // 模拟 6h 定时周期,原文未变

        assertThat(calls.get()).isEqualTo(2);
    }

    /** 新版本发布:只有新块的哈希缺失 → 只译新块;落出窗口的旧版译文继续生效(永久保留)。 */
    @Test
    void newVersionArrives_onlyNewBlockTranslated_oldTranslationsStillApplied() {
        String rawOld = "# Changelog\n\n## 3.0\n- three\n\n## 2.0\n- two\n";
        String rawNew = "# Changelog\n\n## 4.0\n- four\n\n## 3.0\n- three\n\n## 2.0\n- two\n";
        String[] feed = {rawOld, rawNew};
        int[] idx = {0};
        AtomicInteger calls = new AtomicInteger();
        ChangelogService s = service(() -> feed[Math.min(idx[0]++, feed.length - 1)],
                block -> {
                    calls.incrementAndGet();
                    return TRANSLATOR.translate(block);
                },
                2);

        s.get();          // 首轮:3.0、2.0 两块,calls=2
        s.refresh();      // 4.0 到来:窗口=4.0/3.0,仅 4.0 缺失,calls=3

        assertThat(calls.get()).isEqualTo(3);
        ChangelogService.Snapshot snap = s.get();
        assertThat(snap.markdown()).contains("四").contains("三").contains("二");   // 2.0 已出窗仍中文
        assertThat(snap.translatedVersions()).containsExactly("4.0", "3.0", "2.0");
    }

    /** 译制失败:该版保持英文、行不入库;下一轮定时刷新自动重试并成功。 */
    @Test
    void translatorFails_staysEnglish_retriedNextCycle() {
        AtomicInteger calls = new AtomicInteger();
        ChangelogService.Translator flaky = block -> {
            if (calls.incrementAndGet() <= 2) throw new RuntimeException("LLM 宕机");   // 首轮两块全失败
            return TRANSLATOR.translate(block);
        };
        ChangelogService s = service(() -> RAW, flaky, 2);

        assertThat(s.get().markdown()).isEqualTo(RAW);   // 全部透传英文
        assertThat(translationDb).isEmpty();

        s.refresh();   // 下一 6h 周期重试成功
        assertThat(s.get().markdown()).contains("三").contains("二");
    }

    /** 拉取失败(冷启动、DB 空)→ 异常上抛交由 GlobalExceptionHandler → 500,前端重试。 */
    @Test
    void fetchFailsOnColdGet_propagatesAsServerError() {
        ChangelogService s = service(() -> { throw new RuntimeException("GitHub 不可达"); }, TRANSLATOR, 2);

        assertThatThrownBy(s::get).isInstanceOf(RuntimeException.class);
    }

    /** 定时刷新失败(GitHub 不可达)→ 异常止于调度方,内存快照照常服务(不空窗)。 */
    @Test
    void scheduledRefreshFails_servesStaleSnapshot() {
        boolean[] networkUp = {true};
        ChangelogService s = service(() -> {
            if (networkUp[0]) return RAW;
            throw new RuntimeException("GitHub 不可达");
        }, TRANSLATOR, 2);

        s.get();   // 建立快照
        networkUp[0] = false;
        assertThatThrownBy(s::refresh);

        assertThat(s.get().markdown()).contains("三");   // 沿用旧快照
    }

    /** 重启恢复:loadFromDb 从快照表重建内存镜像,译文全量命中 → 零外呼零 LLM。 */
    @Test
    void loadFromDb_restoresSnapshotWithoutNetworkOrLlm() {
        service(() -> RAW, TRANSLATOR, 2).get();   // 前一进程:建库
        assertThat(snapshotRow).isNotNull();

        AtomicInteger calls = new AtomicInteger();
        ChangelogService restarted = service(
                () -> { throw new RuntimeException("重启后 GitHub 不可达"); },   // 任何外呼即失败
                block -> {
                    calls.incrementAndGet();
                    return TRANSLATOR.translate(block);
                },
                2);
        restarted.loadFromDb();

        assertThat(restarted.get().markdown()).contains("三").contains("二");
        assertThat(calls.get()).isZero();
    }

    /** 按需补译:指定旧版本 → 译一块、入库、重拼;重复请求哈希命中零 LLM。 */
    @Test
    void translateVersions_onDemand_persistsAndDedups() {
        ChangelogService s = service(() -> RAW, TRANSLATOR, 2);
        s.get();   // 3.0、2.0 已译

        ChangelogService.Snapshot snap = s.translateVersions(List.of("1.0"));

        assertThat(snap.markdown()).contains("一");
        assertThat(snap.translatedVersions()).contains("1.0");
        assertThat(translationDb).hasSize(3);

        s.translateVersions(List.of("1.0"));   // 已译 → 零调用
        assertThat(translationDb).hasSize(3);
    }

    /** 按需补译遇未知版本号:忽略不炸,快照不变。 */
    @Test
    void translateVersions_unknownTitleIgnored() {
        ChangelogService s = service(() -> RAW, TRANSLATOR, 2);
        s.get();

        ChangelogService.Snapshot snap = s.translateVersions(List.of("9.9"));

        assertThat(snap.translatedVersions()).containsExactly("3.0", "2.0");
        assertThat(snap.markdown()).isEqualTo(s.get().markdown());
    }
}
