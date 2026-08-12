package com.personal.newtab.changelog;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.security.test.context.support.WithUserDetails;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * ChangelogController HTTP 契约测试（见 ADR 0005 / TDD 接缝 3）。
 *
 * <p>不触网：未认证断言在 Service 调用前即由安全链 401 拦截；已认证用例以 {@link MockBean}
 * 替换 Service，仅验证 200 / text/plain / 原样透传。</p>
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ChangelogControllerTest {

    @Autowired private MockMvc mvc;
    @MockBean private ChangelogService changelogService;

    @Test
    void changelogEndpointRequiresAuth() throws Exception {
        mvc.perform(get("/api/changelog"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @WithUserDetails("admin")
    void authenticatedReturnsMarkdownAsPlainText() throws Exception {
        when(changelogService.get()).thenReturn("## 1.0\n- 测试条目\n");
        mvc.perform(get("/api/changelog"))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith(MediaType.TEXT_PLAIN))
                .andExpect(content().string("## 1.0\n- 测试条目\n"));
    }
}
