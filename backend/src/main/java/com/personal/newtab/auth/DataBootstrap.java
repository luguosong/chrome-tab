package com.personal.newtab.auth;

import com.personal.newtab.navlink.NavLink;
import com.personal.newtab.navlink.NavLinkRepository;
import com.personal.newtab.setting.Setting;
import com.personal.newtab.setting.SettingRepository;
import com.personal.newtab.stockwatch.StockWatch;
import com.personal.newtab.stockwatch.StockWatchRepository;
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

import java.util.List;
import java.util.Map;

/**
 * 首启建管理员 + 业务默认数据（导航/观察清单/设置）。
 * 每张表按自身 count==0 判断，互不依赖、可断点续 seed：
 * V1 注释已说明业务 seed 必须走代码（依赖 admin.id，且密码来自环境变量无法写 SQL）。
 */
@Slf4j
@Configuration
@RequiredArgsConstructor
public class DataBootstrap {

    private final UserRepository userRepository;
    private final NavLinkRepository navLinkRepository;
    private final StockWatchRepository stockWatchRepository;
    private final SettingRepository settingRepository;
    private final PasswordEncoder passwordEncoder;

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

    /** 搬自 prototype/index.html 的 STOCKS（13 条），分组按前缀 us→美股/指数，sh/sz→A 股 */
    private static final List<String[]> DEFAULT_STOCKS = List.of(
            new String[]{"usAAPL", "苹果"}, new String[]{"usMSFT", "微软"},
            new String[]{"usNVDA", "英伟达"}, new String[]{"usTSLA", "特斯拉"},
            new String[]{"usGOOGL", "谷歌"}, new String[]{"usDJI", "道指"},
            new String[]{"usIXIC", "纳指"}, new String[]{"usINX", "标普500"},
            new String[]{"sh000001", "上证指数"}, new String[]{"sz399001", "深证成指"},
            new String[]{"sz399006", "创业板指"}, new String[]{"sh600519", "贵州茅台"},
            new String[]{"sz300750", "宁德时代"});

    @Bean
    @Order(Ordered.HIGHEST_PRECEDENCE)   // 必须先于 IconModelMigrationRunner（后者读取本 runner seed 的源表）
    public ApplicationRunner dataBootstrapRunner(
            @Value("${admin.username:admin}") String username,
            @Value("${admin.password:}") String password) {
        return args -> {
            User admin = ensureAdmin(username, password);
            seedNav(admin);
            seedStocks(admin);
            seedSetting(admin);
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

    private void seedNav(User admin) {
        if (navLinkRepository.count() > 0) return;
        for (int i = 0; i < DEFAULT_NAV.size(); i++) {
            NavLink n = new NavLink();
            n.setUserId(admin.getId());
            n.setName(DEFAULT_NAV.get(i).getKey());
            n.setUrl(DEFAULT_NAV.get(i).getValue());
            n.setSortOrder(i);
            navLinkRepository.save(n);
        }
        log.info("已 seed {} 条默认导航", DEFAULT_NAV.size());
    }

    private void seedStocks(User admin) {
        if (stockWatchRepository.count() > 0) return;
        for (int i = 0; i < DEFAULT_STOCKS.size(); i++) {
            String[] s = DEFAULT_STOCKS.get(i);
            StockWatch w = new StockWatch();
            w.setUserId(admin.getId());
            w.setSymbol(s[0]);
            w.setName(s[1]);
            w.setGroupName(StockWatch.groupOf(s[0]));
            w.setSortOrder(i);
            stockWatchRepository.save(w);
        }
        log.info("已 seed {} 条默认观察清单", DEFAULT_STOCKS.size());
    }

    private void seedSetting(User admin) {
        if (settingRepository.count() > 0) return;
        Setting st = new Setting();
        st.setUserId(admin.getId());
        st.setTheme("system");
        settingRepository.save(st);
    }
}
