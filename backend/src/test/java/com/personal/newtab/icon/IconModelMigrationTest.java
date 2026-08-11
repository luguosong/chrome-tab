package com.personal.newtab.icon;

import com.personal.newtab.page.Page;
import com.personal.newtab.page.PageRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 迁移正确性测试（见 spec §接缝1 / issue 01）。
 *
 * <p>非 @Transactional——此测试验证真实提交后的迁移结果；@Transactional 会回滚使后续读取看不到数据。
 * 上下文启动时 DataBootstrap seed nav_links/stock_watches，IconModelMigrationRunner 执行迁移，
 * 各 @Test 只读断言已提交的结果（Spring 默认 context-cache 使上下文仅启动一次）。</p>
 *
 * <p>不连任何外部库：test profile 用 H2 内存库。</p>
 */
@SpringBootTest
@ActiveProfiles("test")
class IconModelMigrationTest {

    @Autowired private PageRepository pageRepository;
    @Autowired private IconRepository iconRepository;

    @Test
    void migrationCreatesDefaultPagesInOrderWithStockOverflow() {
        List<Page> pages = pageRepository.findAll();
        // 3 默认页 + 13 只 medium 股票（6/页满）→ ceil(13/6)=3 个行情页（行情 + 2 续页）= 5 页
        assertThat(pages).hasSize(5);
        List<String> namesInOrder = pages.stream()
                .sorted((a, b) -> Integer.compare(a.getSortOrder(), b.getSortOrder()))
                .map(Page::getName).toList();
        assertThat(namesInOrder).containsExactly(
                IconModelMigration.PAGE_NAV,                    // sortOrder 0
                IconModelMigration.PAGE_CHANGELOG,              // sortOrder 1
                IconModelMigration.PAGE_STOCK,                  // sortOrder 2
                IconModelMigration.PAGE_STOCK_OVERFLOW_PREFIX,  // sortOrder 3（溢出页 1）
                IconModelMigration.PAGE_STOCK_OVERFLOW_PREFIX); // sortOrder 4（溢出页 2）
    }

    @Test
    void migrationConvertsNavLinksToSmallIconsOnNavPage() {
        Page navPage = pageRepository.findAll().stream()
                .filter(p -> p.getName().equals(IconModelMigration.PAGE_NAV)).findFirst().orElseThrow();
        List<Icon> navIcons = iconRepository.findByPageIdOrderBySortOrderAscIdAsc(navPage.getId());
        assertThat(navIcons).hasSize(12);
        assertThat(navIcons).allMatch(i -> i.getType() == IconType.NAV && i.getSize() == Size.SMALL);
        // sort_order 连续 0..11
        for (int i = 0; i < navIcons.size(); i++) {
            assertThat(navIcons.get(i).getSortOrder()).isEqualTo(i);
        }
        // data 含 name + url
        Map<String, Object> firstData = navIcons.get(0).getData();
        assertThat(firstData).containsKeys("name", "url");
    }

    @Test
    void migrationCreatesSingleChangelogLargeIconOnChangelogPage() {
        Page changelogPage = pageRepository.findAll().stream()
                .filter(p -> p.getName().equals(IconModelMigration.PAGE_CHANGELOG)).findFirst().orElseThrow();
        List<Icon> clIcons = iconRepository.findByPageIdOrderBySortOrderAscIdAsc(changelogPage.getId());
        assertThat(clIcons).hasSize(1);
        Icon only = clIcons.get(0);
        assertThat(only.getType()).isEqualTo(IconType.CHANGELOG);
        assertThat(only.getSize()).isEqualTo(Size.LARGE);
        assertThat(only.getData()).isNull();   // changelog 无 data
    }

    @Test
    void migrationConvertsStocksToMediumIconsAndOverflowsToExtraPage() {
        // 13 只 medium（4 格/只），容量 24 格 → 6/页满 → ceil(13/6)=3 个行情页：6 + 6 + 1
        List<Page> stockPages = pageRepository.findAll().stream()
                .filter(p -> p.getName().startsWith(IconModelMigration.PAGE_STOCK))
                .sorted((a, b) -> Integer.compare(a.getSortOrder(), b.getSortOrder()))
                .toList();
        assertThat(stockPages).hasSize(3);

        List<Icon> page1 = iconRepository.findByPageIdOrderBySortOrderAscIdAsc(stockPages.get(0).getId());
        List<Icon> page2 = iconRepository.findByPageIdOrderBySortOrderAscIdAsc(stockPages.get(1).getId());
        List<Icon> page3 = iconRepository.findByPageIdOrderBySortOrderAscIdAsc(stockPages.get(2).getId());
        assertThat(page1).hasSize(6);   // 装满
        assertThat(page2).hasSize(6);   // 装满
        assertThat(page3).hasSize(1);   // 余量
        assertThat(page1).allMatch(i -> i.getType() == IconType.STOCK && i.getSize() == Size.MEDIUM);
        assertThat(page2).allMatch(i -> i.getType() == IconType.STOCK && i.getSize() == Size.MEDIUM);
        assertThat(page3).allMatch(i -> i.getType() == IconType.STOCK && i.getSize() == Size.MEDIUM);
        // 续页内 sort_order 从 0 重新计
        for (int i = 0; i < page2.size(); i++) {
            assertThat(page2.get(i).getSortOrder()).isEqualTo(i);
        }
        for (int i = 0; i < page3.size(); i++) {
            assertThat(page3.get(i).getSortOrder()).isEqualTo(i);
        }
        // 合计 13
        assertThat(page1.size() + page2.size() + page3.size()).isEqualTo(13);
        // data 含 symbol + name
        assertThat(page1.get(0).getData()).containsKeys("symbol", "name");
    }
}
