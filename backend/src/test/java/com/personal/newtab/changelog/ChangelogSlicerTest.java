package com.personal.newtab.changelog;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * ChangelogSlicer 逐版本块切分测试（见 ADR-0017）。
 *
 * <p>纯逻辑无 IO。块边界是增量译制的地基：块原文哈希作译文表主键，边界错一字符即哈希错位。</p>
 */
class ChangelogSlicerTest {

    private static final String MD = "# Changelog\n\n## 3.0\n- three\n\n## 2.0\n- two\n\n## 1.0\n- one\n";

    @Test
    void splitsIntoPrefixAndBlocksInDocumentOrder() {
        ChangelogSlicer.Blocks b = ChangelogSlicer.splitBlocks(MD);

        assertThat(b.prefix()).isEqualTo("# Changelog\n\n");
        assertThat(b.blocks()).extracting(ChangelogSlicer.Block::title)
                .containsExactly("3.0", "2.0", "1.0");   // 新 → 旧
        // 每块含标题行起、到下一版本标题前的全部原文(含块间空行)
        assertThat(b.blocks().get(0).raw()).isEqualTo("## 3.0\n- three\n\n");
        assertThat(b.blocks().get(2).raw()).isEqualTo("## 1.0\n- one\n");
    }

    @Test
    void h3HeadingsBelongToTheirVersionBlock() {
        ChangelogSlicer.Blocks b = ChangelogSlicer.splitBlocks("## 1.0\n### Features\n- x\n");

        assertThat(b.prefix()).isEmpty();
        assertThat(b.blocks()).hasSize(1);
        assertThat(b.blocks().get(0).raw()).isEqualTo("## 1.0\n### Features\n- x\n");
    }

    @Test
    void noVersionHeadings_wholeDocIsPrefix() {
        ChangelogSlicer.Blocks b = ChangelogSlicer.splitBlocks("# 只有标题\n正文\n");

        assertThat(b.prefix()).isEqualTo("# 只有标题\n正文\n");
        assertThat(b.blocks()).isEmpty();
    }

    @Test
    void titleStripsHeadingMarker() {
        // 与前端 parseChangelog 的 h[1].trim() 同规则——按需补译以此串作版本身份
        assertThat(ChangelogSlicer.splitBlocks("## 2.0.14\n- x\n").blocks().get(0).title())
                .isEqualTo("2.0.14");
    }
}
