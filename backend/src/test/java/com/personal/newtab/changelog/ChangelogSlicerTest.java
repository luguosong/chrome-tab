package com.personal.newtab.changelog;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * ChangelogSlicer 纯逻辑测试（见 ADR 0005 / TDD 接缝 1）。
 *
 * <p>期望值均为手算的独立真值（非复刻实现）。核心不变量：对 n≥1 的正常情况，
 * prefix + toTranslate + suffix 必须恒等于原文——未被译制的字节原样保留。</p>
 */
class ChangelogSlicerTest {

    /** 标准 4 版本、n=2：前 2 版进切片，后 2 版进后缀，标题进前缀。 */
    @Test
    void splitKeepsFirstNVersionsAndPreservesUntouchedBytes() {
        String md = "# Changelog\n\n## 1.0\n- feat a\n\n## 2.0\n- feat b\n\n## 3.0\n- feat c\n\n## 4.0\n- feat d\n";

        ChangelogSlicer.Slice s = ChangelogSlicer.split(md, 2);

        assertThat(s.prefix()).isEqualTo("# Changelog\n\n");
        assertThat(s.toTranslate()).isEqualTo("## 1.0\n- feat a\n\n## 2.0\n- feat b\n\n");
        assertThat(s.suffix()).isEqualTo("## 3.0\n- feat c\n\n## 4.0\n- feat d\n");
        // 不变量：三段拼接回原文（未被译制的字节零改动）
        assertThat(s.prefix() + s.toTranslate() + s.suffix()).isEqualTo(md);
    }

    /** 版本数 < n：全部版本进切片，后缀为空。 */
    @Test
    void splitWhenFewerVersionsThanN_SuffixEmpty() {
        String md = "# Changelog\n\n## 1.0\n- a\n\n## 2.0\n- b\n";

        ChangelogSlicer.Slice s = ChangelogSlicer.split(md, 5);

        assertThat(s.prefix()).isEqualTo("# Changelog\n\n");
        assertThat(s.toTranslate()).isEqualTo("## 1.0\n- a\n\n## 2.0\n- b\n");
        assertThat(s.suffix()).isEmpty();
    }

    /** 无任何 `## ` 版本：整篇作前缀，切片与后缀为空（调用方据此跳过译制）。 */
    @Test
    void splitWhenNoVersions_ReturnsWholeDocAsPrefix() {
        String md = "# Notes\n\n只有标题，没有版本。\n";

        ChangelogSlicer.Slice s = ChangelogSlicer.split(md, 5);

        assertThat(s.prefix()).isEqualTo(md);
        assertThat(s.toTranslate()).isEmpty();
        assertThat(s.suffix()).isEmpty();
    }

    /** n=0：不译制任何版本，切片为空，所有版本落入后缀原样保留。 */
    @Test
    void splitWhenNIsZero_TranslatesNothing() {
        String md = "# Changelog\n\n## 1.0\n- a\n\n## 2.0\n- b\n";

        ChangelogSlicer.Slice s = ChangelogSlicer.split(md, 0);

        assertThat(s.prefix()).isEqualTo("# Changelog\n\n");
        assertThat(s.toTranslate()).isEmpty();
        assertThat(s.suffix()).isEqualTo("## 1.0\n- a\n\n## 2.0\n- b\n");
    }

    /** `### ` 三级标题不得被当作版本起点——必须整体留在所属版本块内。 */
    @Test
    void h3HeadingsAreNotVersionStarts() {
        String md = "## 1.0\n### Highlights\n- x\n\n## 2.0\n- y\n";

        ChangelogSlicer.Slice s = ChangelogSlicer.split(md, 1);

        assertThat(s.prefix()).isEmpty();
        assertThat(s.toTranslate()).isEqualTo("## 1.0\n### Highlights\n- x\n\n");
        assertThat(s.suffix()).isEqualTo("## 2.0\n- y\n");
    }

    /** 文档以版本标题开头（无 `# Changelog`）：前缀为空。 */
    @Test
    void docStartingWithVersionHeading_EmptyPrefix() {
        String md = "## 1.0\n- a\n\n## 2.0\n- b";

        ChangelogSlicer.Slice s = ChangelogSlicer.split(md, 1);

        assertThat(s.prefix()).isEmpty();
        assertThat(s.toTranslate()).isEqualTo("## 1.0\n- a\n\n");
        assertThat(s.suffix()).isEqualTo("## 2.0\n- b");
    }
}
