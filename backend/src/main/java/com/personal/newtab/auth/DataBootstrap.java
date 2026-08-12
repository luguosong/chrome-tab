package com.personal.newtab.auth;

import com.personal.newtab.configversion.ConfigVersionService;
import com.personal.newtab.icon.Icon;
import com.personal.newtab.icon.IconRepository;
import com.personal.newtab.icon.IconType;
import com.personal.newtab.icon.Size;
import com.personal.newtab.page.Page;
import com.personal.newtab.page.PageRepository;
import com.personal.newtab.user.User;
import com.personal.newtab.user.UserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 首启建管理员 + 业务默认数据（默认页 / 默认图标）。每张表按自身 count==0 判断，互不依赖、可断点续 seed。
 *
 * <p>03 ticket 起：旧的 nav_links/stock_watches 已删除，默认数据直接以 Icon 模型 seed
 * （3 个默认页 + 12 nav small + 1 changelog large + 13 stock medium）。容量 8×8=64 格下
 * 13 只 medium(52 格) 单页可容纳，不再溢出；超 16 只时仍会溢出到"行情(续)"页（见 seedStocks 逻辑）。
 * seed 完成后给 config_version 一个初始时间戳(ADR-0006),使种子数据对前端镜像可比、首拉即确定版本。</p>
 */
@Slf4j
@Configuration
@RequiredArgsConstructor
public class DataBootstrap {

    /** 固定默认容量兜底（8 列 × 8 行 = 64 格）；前端镜像同值（DEFAULT_PAGE_CAPACITY）。 */
    public static final int DEFAULT_CAPACITY_CELLS = 64;
    public static final String PAGE_NAV = "快速导航";
    public static final String PAGE_CHANGELOG = "日志更新";
    public static final String PAGE_STOCK = "行情";
    public static final String PAGE_STOCK_OVERFLOW_PREFIX = "行情(续)";

    /** 搬自 prototype/index.html 的 DEFAULT_NAV（12 条） */
    private static final List<Map.Entry<String, String>> DEFAULT_NAV = List.of(
            Map.entry("GitHub", "https://github.com"),
            Map.entry("谷歌", "https://www.google.com"),
            Map.entry("StackOverflow", "https://stackoverflow.com"),
            Map.entry("MDN", "https://developer.mozilla.org"),
            Map.entry("知乎", "https://www.zhihu.com"),
            Map.entry("掘金", "https://juejin.cn"),
            Map.entry("V2EX", "https://www.v2ex.com"),
            Map.entry("npm", "https://www.npmjs.com"),
            Map.entry("React", "https://react.dev"),
            Map.entry("Vue", "https://vuejs.org"),
            Map.entry("B站", "https://www.bilibili.com"),
            Map.entry("HN", "https://news.ycombinator.com"));

    /** 搬自 prototype/index.html 的 STOCKS（13 条） */
    private static final List<String[]> DEFAULT_STOCKS = List.of(
            new String[]{"usAAPL", "苹果"}, new String[]{"usMSFT", "微软"},
            new String[]{"usNVDA", "英伟达"}, new String[]{"usTSLA", "特斯拉"},
            new String[]{"usGOOGL", "谷歌"}, new String[]{"usDJI", "道指"},
            new String[]{"usIXIC", "纳指"}, new String[]{"usINX", "标普500"},
            new String[]{"sh000001", "上证指数"}, new String[]{"sz399001", "深证成指"},
            new String[]{"sz399006", "创业板指"}, new String[]{"sh600519", "贵州茅台"},
            new String[]{"sz300750", "宁德时代"});

    private final UserRepository userRepository;
    private final PageRepository pageRepository;
    private final IconRepository iconRepository;
    private final PasswordEncoder passwordEncoder;
    private final ConfigVersionService configVersionService;

    @Bean
    @Order(Ordered.HIGHEST_PRECEDENCE)
    public ApplicationRunner dataBootstrapRunner(
            @Value("${admin.username:admin}") String username,
            @Value("${admin.password:}") String password) {
        return args -> {
            User admin = ensureAdmin(username, password);
            seedPagesAndIcons(admin);
        };
    }

    private User ensureAdmin(String username, String password) {
        if (userRepository.count() == 0) {
            if (password == null || password.isBlank()) {
                throw new IllegalStateException("首次启动必须设置环境变量 ADMIN_PASSWORD");
            }
            User u = new User();
            u.setUsername(username);
            u.setPassword(passwordEncoder.encode(password));
            userRepository.save(u);
            log.warn("已从 ADMIN_PASSWORD 创建管理员 '{}'，登录后请改密", username);
            return u;
        }
        // 单管理员：现有用户即管理员
        return userRepository.findAll().get(0);
    }

    /**
     * 直接 seed Icon 模型默认数据。幂等：pages.count()==0 时才执行。
     * 03 之前由 IconModelMigration 从 nav_links/stock_watches 转换而来；删除旧表后改为直接 seed。
     */
    private void seedPagesAndIcons(User admin) {
        if (pageRepository.count() > 0) return;
        Long uid = admin.getId();

        // 1. 默认 3 页
        Page navPage = pageRepository.save(makePage(uid, PAGE_NAV, 0));
        Page changelogPage = pageRepository.save(makePage(uid, PAGE_CHANGELOG, 1));
        Page stockPage = pageRepository.save(makePage(uid, PAGE_STOCK, 2));
        List<Page> pages = new ArrayList<>(List.of(navPage, changelogPage, stockPage));

        // 2. nav → icons(small)
        int so = 0;
        for (Map.Entry<String, String> n : DEFAULT_NAV) {
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("name", n.getKey());
            data.put("url", n.getValue());
            iconRepository.save(makeIcon(uid, navPage.getId(), IconType.NAV, Size.SMALL, so++, data));
        }

        // 3. changelog → 1 个 large 单例 icon
        iconRepository.save(makeIcon(uid, changelogPage.getId(), IconType.CHANGELOG, Size.LARGE, 0, null));

        // 4. stocks → icons(medium)，超容量溢出到追加页
        int perPage = DEFAULT_CAPACITY_CELLS / Size.MEDIUM.cells();   // 64 / 4 = 16
        Page current = stockPage;
        int currentIdx = 0;
        int pageOrder = 3;
        so = 0;
        for (String[] s : DEFAULT_STOCKS) {
            if (currentIdx >= perPage) {
                current = pageRepository.save(makePage(uid, PAGE_STOCK_OVERFLOW_PREFIX, pageOrder++));
                pages.add(current);
                currentIdx = 0;
                so = 0;
            }
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("symbol", s[0]);
            data.put("name", s[1]);
            iconRepository.save(makeIcon(uid, current.getId(), IconType.STOCK, Size.MEDIUM, so++, data));
            currentIdx++;
        }
        // 种子数据落一个初始 config_version 时间戳:首拉即有确定版本,前端镜像可比(ADR-0006)。
        configVersionService.touch(uid);
        log.info("已 seed {} 页 / {} 图标", pages.size(),
                DEFAULT_NAV.size() + 1 + DEFAULT_STOCKS.size());
    }

    private Page makePage(Long userId, String name, int sortOrder) {
        Page p = new Page();
        p.setUserId(userId);
        p.setName(name);
        p.setSortOrder(sortOrder);
        return p;
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
