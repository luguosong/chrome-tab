package com.personal.newtab.changelog;

import lombok.extern.slf4j.Slf4j;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.LocalDateTime;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 更新日志译制编排（见 ADR 0005 / ADR-0017）。
 *
 * <p>请求路径纯读内存快照(volatile 原子换新),零外呼零 LLM;快照由
 * {@link ChangelogScheduler} 每 6 小时定时预取刷新(ADR-0017),打开抽屉不再是拉取触发点。
 * 增量检测是纯算法:原文逐版本块切分,块哈希比对译文表(主键=块原文 SHA-256),
 * 只有哈希缺失的块才调 LLM(每块一次),零 token 花在「判断是否有更新」上。</p>
 *
 * <p>持久化(MySQL,ADR-0017):译文表一版一行、永久保留——每版终身只译一次,重启零重译;
 * 快照表单行存原文 + npm 发布日期,启动时 {@link #loadFromDb()} 恢复内存镜像。
 * 原文是唯一事实源,译文按块哈希覆盖其上拼装(overlay),落出窗口的旧版译文继续生效。
 * 译制失败(抛异常)或译制方拒绝(返回 null,如 Key 缺失)→ 记 warn、该版保持英文,
 * 行不入库 → 下轮自动重试。refresh/translateVersions {@code synchronized} 互斥,避免并发重复译制。
 * IO 由注入的协作器承担,便于单测。</p>
 */
@Slf4j
public class ChangelogService {

    /** 拉取 CHANGELOG.md 原文。失败抛异常 → 兜底路径 500,前端走"刷新失败/重试"。 */
    @FunctionalInterface
    public interface MarkdownFetcher {
        String fetch() throws Exception;
    }

    /** 译制单个版本块。返回 null 表示"不译制"(如未配置 Key);抛异常表示译制失败。 */
    @FunctionalInterface
    public interface Translator {
        String translate(String versionBlock) throws Exception;
    }

    /** 内存快照:markdown = 拼装后全文;translatedVersions = 已有译文的版本号(前端补译按钮依据);blocks 供按需补译免重切。 */
    public record Snapshot(String markdown, String releasedAt, Set<String> translatedVersions,
                           ChangelogSlicer.Blocks blocks) {}

    private final MarkdownFetcher fetcher;
    private final Translator translator;
    private final ChangelogTranslationRepository translations;
    private final ChangelogSnapshotRepository snapshots;
    private final NpmReleaseDateService npmDates;
    private final int translateRecent;

    private volatile Snapshot memory;

    public ChangelogService(MarkdownFetcher fetcher, Translator translator,
                            ChangelogTranslationRepository translations,
                            ChangelogSnapshotRepository snapshots,
                            NpmReleaseDateService npmDates,
                            int translateRecent) {
        this.fetcher = fetcher;
        this.translator = translator;
        this.translations = translations;
        this.snapshots = snapshots;
        this.npmDates = npmDates;
        this.translateRecent = translateRecent;
    }

    /** 读快照。内存空(首次部署、定时任务尚未跑成)→ 同步兜底刷新一次;仍失败则异常上抛 → 500。 */
    public Snapshot get() {
        Snapshot s = memory;
        if (s == null) {
            refresh();
            s = memory;
        }
        return s;
    }

    /** 启动时从快照表恢复内存镜像:零外呼、零 LLM。表空则无操作,等定时/兜底路径。 */
    public void loadFromDb() {
        snapshots.findById(ChangelogSnapshot.SINGLE_ID).ifPresent(row -> {
            ChangelogSlicer.Blocks blocks = ChangelogSlicer.splitBlocks(row.getRawMarkdown());
            memory = assemble(blocks, loadTranslations(blocks), row.getReleasedAt());
        });
    }

    /** 定时/预热刷新:拉原文 → 只译最近 N 版中缺失的块 → 快照落库 → 换内存镜像。拉取失败抛异常,由调度方决定降级。 */
    public synchronized void refresh() {
        String raw;
        try {
            raw = fetcher.fetch();
        } catch (Exception e) {
            throw new RuntimeException("拉取更新日志原文失败", e);
        }
        ChangelogSlicer.Blocks blocks = ChangelogSlicer.splitBlocks(raw);
        Map<String, String> byHash = loadTranslations(blocks);
        List<ChangelogSlicer.Block> list = blocks.blocks();
        for (int i = 0; i < Math.min(translateRecent, list.size()); i++) {
            translateIfMissing(list.get(i), byHash);
        }
        String releasedAt = npmDates.fetchLatestReleaseDate();   // 失败 null,不阻塞主链路
        snapshots.save(new ChangelogSnapshot(ChangelogSnapshot.SINGLE_ID, raw, releasedAt, LocalDateTime.now()));
        memory = assemble(blocks, byHash, releasedAt);
    }

    /** 前端按需补译(ADR-0017):指定版本缺失则译、入库、重拼。已译的跳过(零 LLM),失败的该版保持英文。 */
    public synchronized Snapshot translateVersions(List<String> titles) {
        Snapshot s = get();   // 冷启动兜底:内存空先拉一次
        Map<String, String> byHash = loadTranslations(s.blocks());
        for (ChangelogSlicer.Block b : s.blocks().blocks()) {
            if (titles.contains(b.title())) {
                translateIfMissing(b, byHash);
            }
        }
        memory = assemble(s.blocks(), byHash, s.releasedAt());
        return memory;
    }

    /** 译一个块:哈希命中直接返回(零 LLM);译成则入库 + 更新拼装映射;失败/拒绝仅 warn,不入库待下轮重试。 */
    private void translateIfMissing(ChangelogSlicer.Block block, Map<String, String> byHash) {
        String hash = sha256(block.raw());
        if (byHash.containsKey(hash)) {
            return;
        }
        String translated;
        try {
            translated = translator.translate(block.raw());
        } catch (Exception e) {
            log.warn("版本 {} 译制失败,保持英文: {}", block.title(), e.toString());
            return;
        }
        if (translated == null) {
            log.warn("版本 {} 译制被拒绝(API Key 缺失?),保持英文", block.title());
            return;
        }
        translations.save(new ChangelogTranslation(hash, translated));
        byHash.put(hash, translated);
    }

    /** 批量捞现有译文 → 哈希 → 译文 映射(拼装与缺失比对共用一次查询)。 */
    private Map<String, String> loadTranslations(ChangelogSlicer.Blocks blocks) {
        List<String> hashes = blocks.blocks().stream().map(b -> sha256(b.raw())).toList();
        Map<String, String> byHash = new LinkedHashMap<>();
        for (ChangelogTranslation t : translations.findByBlockHashIn(hashes)) {
            byHash.put(t.getBlockHash(), t.getTranslated());
        }
        return byHash;
    }

    /** 拼装:前缀 + 每块取译文(哈希命中)或原文。translatedVersions 与拼装同源,前端据此渲染补译按钮。 */
    private Snapshot assemble(ChangelogSlicer.Blocks blocks, Map<String, String> byHash, String releasedAt) {
        StringBuilder sb = new StringBuilder(blocks.prefix());
        Set<String> translatedTitles = new LinkedHashSet<>();
        for (ChangelogSlicer.Block b : blocks.blocks()) {
            String translated = byHash.get(sha256(b.raw()));
            if (translated != null) {
                sb.append(translated);
                translatedTitles.add(b.title());
            } else {
                sb.append(b.raw());
            }
        }
        return new Snapshot(sb.toString(), releasedAt, translatedTitles, blocks);
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
