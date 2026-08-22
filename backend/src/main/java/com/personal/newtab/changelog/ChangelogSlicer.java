package com.personal.newtab.changelog;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 把 CHANGELOG.md 切成「前缀 + 版本块列表」（见 ADR 0005 / ADR-0017）。
 *
 * <p>每个 {@code ## } 版本标题起一个块,块含标题行到下一版本标题(或文末)的全部原文。
 * 逐块切分是增量译制的基础:块原文哈希作译文表主键,新旧原文逐块比对,只有哈希缺失的块
 * 才需要译制(ADR-0017);拼装 = 前缀 + 每块取译文或原文,译文永远只覆盖自己那一块。</p>
 *
 * <p>版本起点 = 行首的 {@code ## }(两个井号 + 空白);{@code ### } 三级标题不算版本起点,
 * 整体归入其所属版本块。前缀 = 首个版本标题之前的全部内容(通常是 {@code # Changelog} 标题)。
 * {@code title} 与前端 {@code parseChangelog} 的 {@code h[1].trim()} 同规则,可互为身份标识。</p>
 */
public final class ChangelogSlicer {

    private static final Pattern VERSION_HEADING = Pattern.compile("(?m)^##\\s");

    /** 一个版本块:title = 版本号(如 {@code 2.0.14}),raw = 含标题行的整块原文。 */
    public record Block(String title, String raw) {}

    /** prefix = 首个版本标题前的全部内容;blocks 按文档顺序(新 → 旧)。 */
    public record Blocks(String prefix, List<Block> blocks) {}

    private ChangelogSlicer() {}

    public static Blocks splitBlocks(String markdown) {
        Matcher m = VERSION_HEADING.matcher(markdown);
        List<Integer> starts = new ArrayList<>();
        while (m.find()) {
            starts.add(m.start());
        }
        if (starts.isEmpty()) {
            // 无版本标题:整篇作前缀,无版本块
            return new Blocks(markdown, List.of());
        }
        String prefix = markdown.substring(0, starts.get(0));
        List<Block> blocks = new ArrayList<>();
        for (int i = 0; i < starts.size(); i++) {
            int end = (i + 1 < starts.size()) ? starts.get(i + 1) : markdown.length();
            String raw = markdown.substring(starts.get(i), end);
            blocks.add(new Block(titleOf(raw), raw));
        }
        return new Blocks(prefix, List.copyOf(blocks));
    }

    /** 块首行去掉 {@code ## } 前缀得版本号,规则与前端 parseChangelog 对齐。 */
    private static String titleOf(String raw) {
        int nl = raw.indexOf('\n');
        String heading = nl < 0 ? raw : raw.substring(0, nl);
        return heading.replaceFirst("^##\\s*", "").trim();
    }
}
