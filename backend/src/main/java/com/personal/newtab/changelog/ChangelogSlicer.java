package com.personal.newtab.changelog;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 把 CHANGELOG.md 切成「前缀 + 待译制切片 + 后缀」三段（见 ADR 0005）。
 *
 * <p>只把最近 {@code n} 个 {@code ## } 版本块划入待译制切片，更早的版本原样留在后缀。
 * 上游 claude-code CHANGELOG.md 实测 ~164K token，整篇一次译制不可行，故强制截断到最近 n 版。
 * 未被译制的字节（前缀 + 后缀）零改动，保证 prefix + 译文 + suffix 仍是合法 markdown。</p>
 *
 * <p>版本起点 = 行首的 {@code ## }（两个井号 + 空白）；{@code ### } 三级标题不算版本起点，
 * 整体归入其所属版本块。前缀 = 首个版本标题之前的全部内容（通常是 {@code # Changelog} 标题）。</p>
 */
public final class ChangelogSlicer {

    private static final Pattern VERSION_HEADING = Pattern.compile("(?m)^##\\s");

    public record Slice(String prefix, String toTranslate, String suffix) {}

    private ChangelogSlicer() {}

    public static Slice split(String markdown, int n) {
        Matcher m = VERSION_HEADING.matcher(markdown);
        List<Integer> starts = new ArrayList<>();
        while (m.find()) {
            starts.add(m.start());
            // 只需前 n+1 个起点：前 n 个界定待译制区间，第 n+1 个界定后缀起点
            if (starts.size() == n + 1) break;
        }
        if (starts.isEmpty()) {
            // 无版本标题：整篇作前缀，无可译制
            return new Slice(markdown, "", "");
        }
        int first = starts.get(0);
        String prefix = markdown.substring(0, first);
        if (starts.size() <= n) {
            // 版本数不足 n：全部版本进切片，后缀为空
            return new Slice(prefix, markdown.substring(first), "");
        }
        // starts.size() == n+1：第 n+1 个起点即后缀起点
        int suffixStart = starts.get(n);
        return new Slice(prefix, markdown.substring(first, suffixStart), markdown.substring(suffixStart));
    }
}
