package com.personal.newtab.icon;

import com.personal.newtab.navlink.NavLink;
import com.personal.newtab.navlink.NavLinkRepository;
import com.personal.newtab.page.Page;
import com.personal.newtab.page.PageRepository;
import com.personal.newtab.stockwatch.StockWatch;
import com.personal.newtab.stockwatch.StockWatchRepository;
import com.personal.newtab.user.User;
import com.personal.newtab.user.UserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 一次性数据迁移（见 spec 实现决策 §迁移）：
 * 为现有 admin 创建 3 个默认页（快速导航/日志更新/行情），把现有 nav_links/stock_watches/更新日志流
 * 转成 icons 实例。链接=small、股票=medium、日志=large（单例，1 条）。
 * 股票超单页容量（6 列 × 4 行 = 24 格，medium=4 格 → 6 只/页）则按"装满一页再开续页"溢出到追加页。
 *
 * 幂等：以 pages.count()==0 判定——仅在未迁移过时执行。升级库与干净库都能正确收敛：
 * 干净库时 nav_links/stock_watches 已被 DataBootstrap seed，本迁移把它们镜像到 icons；
 * 升级库时已有数据被迁移进 icons。两侧最终一致。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class IconModelMigration {

    /** 固定默认容量兜底（6 列 × 4 行 = 24 格）；前端按实际视口即时反馈。见 issue 01 Comments。 */
    public static final int DEFAULT_CAPACITY_CELLS = 24;
    public static final String PAGE_NAV = "快速导航";
    public static final String PAGE_CHANGELOG = "日志更新";
    public static final String PAGE_STOCK = "行情";
    public static final String PAGE_STOCK_OVERFLOW_PREFIX = "行情(续)";

    private final UserRepository userRepository;
    private final PageRepository pageRepository;
    private final IconRepository iconRepository;
    private final NavLinkRepository navLinkRepository;
    private final StockWatchRepository stockWatchRepository;

    /**
     * 执行迁移。返回创建的页（按 sortOrder 升序）。调用方负责 idempotency 守卫（pages.count()==0）。
     * 单事务，失败回滚。读取已有 nav_links/stock_watches（DataBootstrap 已 seed）。
     */
    @Transactional
    public List<Page> migrate() {
        if (pageRepository.count() > 0) {
            return pageRepository.findAll();
        }
        // 单管理员项目：现有用户即 admin
        User admin = userRepository.findAll().get(0);
        Long uid = admin.getId();

        // 1. 默认 3 页
        Page navPage = makePage(uid, PAGE_NAV, 0);
        Page changelogPage = makePage(uid, PAGE_CHANGELOG, 1);
        Page stockPage = makePage(uid, PAGE_STOCK, 2);
        List<Page> pages = new ArrayList<>(List.of(navPage, changelogPage, stockPage));

        // 2. nav_links → icons(small)
        List<NavLink> navs = navLinkRepository.findByUserIdOrderBySortOrderAscIdAsc(uid);
        int so = 0;
        for (NavLink n : navs) {
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("name", n.getName());
            data.put("url", n.getUrl());
            iconRepository.save(makeIcon(uid, navPage.getId(), IconType.NAV, Size.SMALL, so++, data));
        }
        log.info("迁移 nav_links → icons: {} 条", navs.size());

        // 3. changelog → 1 个 large 单例 icon
        iconRepository.save(makeIcon(uid, changelogPage.getId(), IconType.CHANGELOG, Size.LARGE, 0, null));
        log.info("迁移 changelog → icons: 1 条（单例）");

        // 4. stock_watches → icons(medium)，超容量溢出到追加页
        List<StockWatch> stocks = stockWatchRepository.findByUserIdOrderByGroupNameAscSortOrderAscIdAsc(uid);
        int perPage = DEFAULT_CAPACITY_CELLS / Size.MEDIUM.cells();   // 24 / 4 = 6
        Page current = stockPage;
        int currentIdx = 0;
        int pageOrder = 3;
        so = 0;
        for (StockWatch s : stocks) {
            if (currentIdx >= perPage) {
                // 当前页装满，开续页
                current = pageRepository.save(makePage(uid, PAGE_STOCK_OVERFLOW_PREFIX, pageOrder++));
                pages.add(current);
                currentIdx = 0;
                so = 0;
            }
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("symbol", s.getSymbol());
            data.put("name", s.getName());
            iconRepository.save(makeIcon(uid, current.getId(), IconType.STOCK, Size.MEDIUM, so++, data));
            currentIdx++;
        }
        log.info("迁移 stock_watches → icons: {} 条，分布在 {} 个行情页", stocks.size(),
                pages.stream().filter(p -> p.getName().startsWith("行情")).count());

        return pages;
    }

    private Page makePage(Long userId, String name, int sortOrder) {
        // 不传 id/createdAt——让 JPA 生成 id、字段默认值 LocalDateTime.now() 填 createdAt
        // （H2 create-drop 无 DB 端 DEFAULT，必须由实体侧给值）
        Page p = new Page();
        p.setUserId(userId);
        p.setName(name);
        p.setSortOrder(sortOrder);
        return pageRepository.save(p);
    }

    private Icon makeIcon(Long userId, Long pageId, IconType type, Size size, int sortOrder, Map<String, Object> data) {
        Icon i = new Icon();
        i.setUserId(userId);
        i.setPageId(pageId);
        i.setType(type);
        i.setSize(size);
        i.setSortOrder(sortOrder);
        i.setData(data);
        return i;
    }
}
