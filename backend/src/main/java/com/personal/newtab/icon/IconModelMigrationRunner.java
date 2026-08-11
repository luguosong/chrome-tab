package com.personal.newtab.icon;

import com.personal.newtab.auth.DataBootstrap;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;

/**
 * 启动时触发 Icon/Page 模型迁移。必须晚于 {@link DataBootstrap}（后者 seed nav_links/stock_watches），
 * 否则迁移读不到源数据。@Order(HIGHEST_PRECEDENCE + 100) 保证在 DataBootstrap（HIGHEST_PRECEDENCE）之后执行。
 * 幂等由 IconModelMigration 内部 pages.count()==0 守卫。
 */
@Slf4j
@Configuration
@RequiredArgsConstructor
public class IconModelMigrationRunner {

    private final IconModelMigration migration;

    @Bean
    @Order(Ordered.HIGHEST_PRECEDENCE + 100)
    public ApplicationRunner runIconModelMigration() {
        return args -> migration.migrate();
    }
}
