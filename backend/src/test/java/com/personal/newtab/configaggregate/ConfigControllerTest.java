package com.personal.newtab.configaggregate;

import com.personal.newtab.auth.DataBootstrap;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.test.context.support.WithUserDetails;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 聚合接口 GET /api/config 验证（见 spec §接缝1 / issue 03）。
 *
 * <p>@Transactional（spec §接缝1 要求）：每测结束回滚，即使误连也不持久化。
 * 上下文启动时 DataBootstrap 已 seed 完整默认数据（3 默认页 + 续页 + 26 图标），本类只读。
 * admin 用户由 DataBootstrap 创建，@WithUserDetails("admin") 走 CustomUserDetailsService 注入带 id 的 principal。</p>
 *
 * <p>不连任何外部库：test profile 用 H2 内存库。</p>
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class ConfigControllerTest {

    @Autowired private MockMvc mvc;

    @Test
    @WithUserDetails("admin")
    void getConfigReturnsOnlyNewModelFields() throws Exception {
        mvc.perform(get("/api/config"))
                .andExpect(status().isOk())
                // 03 ticket：旧字段已删除
                .andExpect(jsonPath("$.navLinks").doesNotExist())
                .andExpect(jsonPath("$.stockWatches").doesNotExist())
                // 新字段
                .andExpect(jsonPath("$.pages").isArray())
                .andExpect(jsonPath("$.icons").isArray())
                .andExpect(jsonPath("$.setting.theme").value("system"))
                // 默认 3 页 + 13 只 medium 股票 ceil(13/6)=2 续页 = 5
                .andExpect(jsonPath("$.pages.length()").value(5))
                .andExpect(jsonPath("$.pages[0].name").value(DataBootstrap.PAGE_NAV))
                .andExpect(jsonPath("$.pages[0].sortOrder").value(0))
                // 12 nav(small) + 1 changelog(large) + 13 stock(medium) = 26 icons
                .andExpect(jsonPath("$.icons.length()").value(26))
                // 第一个 icon 是 nav，small，含 data.name + data.url
                .andExpect(jsonPath("$.icons[0].type").value("NAV"))
                .andExpect(jsonPath("$.icons[0].size").value("SMALL"))
                .andExpect(jsonPath("$.icons[0].data.name").exists())
                .andExpect(jsonPath("$.icons[0].data.url").exists())
                .andExpect(jsonPath("$.icons[0].pageId").exists())
                .andExpect(jsonPath("$.icons[0].sortOrder").value(0));
    }

    @Test
    @WithUserDetails("admin")
    void legacyNavLinksEndpointReturns404() throws Exception {
        // 03 ticket：旧端点已删除（控制器移除）→ Spring MVC 无映射 → 404
        mvc.perform(get("/api/nav-links")).andExpect(status().isNotFound());
    }

    @Test
    @WithUserDetails("admin")
    void legacyStockWatchesEndpointReturns404() throws Exception {
        mvc.perform(get("/api/stock-watches")).andExpect(status().isNotFound());
    }

    @Test
    void getConfigWithoutAuthReturns401() throws Exception {
        mvc.perform(get("/api/config"))
                .andExpect(status().isUnauthorized());
    }
}
