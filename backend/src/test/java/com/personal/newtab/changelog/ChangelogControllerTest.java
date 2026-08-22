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

import java.util.LinkedHashSet;
import java.util.List;

import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * ChangelogController HTTP 契约测试（见 ADR 0005 / ADR-0016 / ADR-0017 / TDD 接缝 3）。
 *
 * <p>不触网：未认证断言在 Service 调用前即由安全链 401 拦截；已认证用例以 {@link MockBean}
 * 替换 Service，仅验证 200 / JSON / markdown、releasedAt、translatedVersions 透传与
 * POST /translate 的请求体 → 响应契约（ADR-0017 按需补译）。</p>
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ChangelogControllerTest {

    @Autowired private MockMvc mvc;
    @MockBean private ChangelogService changelogService;

    private static ChangelogService.Snapshot snapshot(String markdown, String releasedAt, String... translated) {
        return new ChangelogService.Snapshot(markdown, releasedAt, new LinkedHashSet<>(List.of(translated)),
                ChangelogSlicer.splitBlocks(markdown));
    }

    @Test
    void changelogEndpointsRequireAuth() throws Exception {
        mvc.perform(get("/api/changelog")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/changelog/translate")).andExpect(status().isUnauthorized());
    }

    @Test
    @WithUserDetails("admin")
    void authenticatedReturnsMarkdownReleasedAtAndTranslatedVersions() throws Exception {
        when(changelogService.get()).thenReturn(snapshot("## 1.0\n- 测试条目\n", "2026-08-19T00:00:00.000Z", "1.0"));
        mvc.perform(get("/api/changelog"))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.markdown").value("## 1.0\n- 测试条目\n"))
                .andExpect(jsonPath("$.releasedAt").value("2026-08-19T00:00:00.000Z"))
                .andExpect(jsonPath("$.translatedVersions[0]").value("1.0"));
    }

    @Test
    @WithUserDetails("admin")
    void releasedAtNullWhenNpmUnavailable() throws Exception {
        // npm 拉取失败 → releasedAt null(前端日期行降级「—」),markdown 不受阻塞
        when(changelogService.get()).thenReturn(snapshot("## 1.0\n", null));
        mvc.perform(get("/api/changelog"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.markdown").value("## 1.0\n"))
                .andExpect(jsonPath("$.releasedAt").value((String) null))
                .andExpect(jsonPath("$.translatedVersions").isEmpty());
    }

    @Test
    @WithUserDetails("admin")
    void translatePassesVersionsAndReturnsFreshSnapshot() throws Exception {
        when(changelogService.translateVersions(List.of("1.0", "0.9")))
                .thenReturn(snapshot("## 1.0\n- 译\n", null, "1.0", "0.9"));
        mvc.perform(post("/api/changelog/translate")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"versions\":[\"1.0\",\"0.9\"]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.markdown").value("## 1.0\n- 译\n"))
                .andExpect(jsonPath("$.translatedVersions.length()").value(2));
        verify(changelogService).translateVersions(List.of("1.0", "0.9"));
    }

    @Test
    @WithUserDetails("admin")
    void translateWithMissingBodyIsNoOp() throws Exception {
        // 请求体缺 versions → 空列表,不 500
        when(changelogService.translateVersions(List.of())).thenReturn(snapshot("## 1.0\n", null));
        mvc.perform(post("/api/changelog/translate")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isOk());
        verify(changelogService).translateVersions(List.of());
    }
}
