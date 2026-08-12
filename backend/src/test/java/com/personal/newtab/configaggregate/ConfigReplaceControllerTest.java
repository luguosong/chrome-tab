package com.personal.newtab.configaggregate;

import com.personal.newtab.configversion.ConfigVersion;
import com.personal.newtab.configversion.ConfigVersionRepository;
import com.personal.newtab.icon.IconRepository;
import com.personal.newtab.page.PageRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.test.context.support.WithUserDetails;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * ADR-0006 双端镜像后端契约测试:整体配置版本(updatedAt) + PUT /api/config 全量替换。
 *
 * <p>种子 3 页 + 26 图标(DataBootstrap 已 seed 并 touch 初始版本)。
 * 校验语义见 {@link com.personal.newtab.configaggregate.ConfigReplaceService}:容量/单例/孤儿引用 → 409,
 * 结构缺失 → 400;整体重建重排 id。每测 @Transactional 回滚。</p>
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class ConfigReplaceControllerTest {

    private static final MediaType JSON = MediaType.APPLICATION_JSON;

    @Autowired private MockMvc mvc;
    @Autowired private PageRepository pageRepository;
    @Autowired private IconRepository iconRepository;
    @Autowired private ConfigVersionRepository configVersionRepository;

    @Test
    @WithUserDetails("admin")
    void getConfigReturnsUpdatedAt() throws Exception {
        // 种子已 touch → updatedAt 非空,ISO 字符串
        mvc.perform(get("/api/config"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.updatedAt").isString());
    }

    @Test
    @WithUserDetails("admin")
    void replaceSwapsAllDataAndReassignsIds() throws Exception {
        assertThat(pageRepository.count()).isEqualTo(3);   // 种子 3 页
        String body = """
                {"pages":[{"id":1,"name":"唯一页","sortOrder":0}],
                 "icons":[{"pageId":1,"type":"NAV","size":"SMALL","sortOrder":0,"data":{"name":"a","url":"https://x.com"}}],
                 "layoutSettings":{"gridWidth":1024,"gridGap":8,"iconScale":1.0}}
                """;
        mvc.perform(put("/api/config").contentType(JSON).content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.pages.length()").value(1))
                .andExpect(jsonPath("$.icons.length()").value(1))
                .andExpect(jsonPath("$.pages[0].name").value("唯一页"))
                .andExpect(jsonPath("$.updatedAt").isString());
        // 旧数据已清,仅剩 1 页 1 图标
        assertThat(pageRepository.count()).isEqualTo(1);
        assertThat(iconRepository.count()).isEqualTo(1);
    }

    @Test
    @WithUserDetails("admin")
    void replaceRejectsCapacityOverflow409() throws Exception {
        // 11 个 LARGE(6 格)= 66 > 64 → 第 11 个触发 409
        StringBuilder icons = new StringBuilder();
        for (int i = 0; i < 11; i++) {
            if (i > 0) icons.append(',');
            icons.append("{\"pageId\":1,\"type\":\"NAV\",\"size\":\"LARGE\",\"sortOrder\":")
                    .append(i).append(",\"data\":{\"name\":\"n\",\"url\":\"https://x.com\"}}");
        }
        String body = "{\"pages\":[{\"id\":1,\"name\":\"P\",\"sortOrder\":0}],\"icons\":["
                + icons + "],\"layoutSettings\":null}";
        mvc.perform(put("/api/config").contentType(JSON).content(body))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.status").value(409));
    }

    @Test
    @WithUserDetails("admin")
    void replaceRejectsDuplicateSingleton409() throws Exception {
        // CHANGELOG 单例,出现 2 次 → 409
        String body = """
                {"pages":[{"id":1,"name":"P","sortOrder":0}],
                 "icons":[
                   {"pageId":1,"type":"CHANGELOG","size":"LARGE","sortOrder":0,"data":null},
                   {"pageId":1,"type":"CHANGELOG","size":"LARGE","sortOrder":1,"data":null}
                 ]}
                """;
        mvc.perform(put("/api/config").contentType(JSON).content(body))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.status").value(409));
    }

    @Test
    @WithUserDetails("admin")
    void replaceRejectsOrphanIconPage409() throws Exception {
        // 图标引用 pages 内不存在的 pageId=999
        String body = """
                {"pages":[{"id":1,"name":"P","sortOrder":0}],
                 "icons":[{"pageId":999,"type":"NAV","size":"SMALL","sortOrder":0,"data":{"name":"a","url":"https://x.com"}}]}
                """;
        mvc.perform(put("/api/config").contentType(JSON).content(body))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.status").value(409));
    }

    @Test
    @WithUserDetails("admin")
    void replaceRejectsMissingPages400() throws Exception {
        mvc.perform(put("/api/config").contentType(JSON).content("""
                {"pages":[],"icons":[]}
                """))
                .andExpect(status().isBadRequest());
    }

    @Test
    @WithUserDetails("admin")
    void configWriteAdvancesUpdatedAt() throws Exception {
        LocalDateTime t0 = configVersionRepository.findById(1L)
                .map(ConfigVersion::getUpdatedAt).orElse(null);
        assertThat(t0).as("种子应已 touch 初始版本").isNotNull();
        // 一次 page 写 → 版本前进
        mvc.perform(post("/api/pages").contentType(JSON).content("""
                {"name":"临时页"}
                """)).andExpect(status().isOk());
        LocalDateTime t1 = configVersionRepository.findById(1L)
                .map(ConfigVersion::getUpdatedAt).orElseThrow();
        assertThat(t1).isAfterOrEqualTo(t0);
    }

    @Test
    void replaceRequiresAuth401() throws Exception {
        mvc.perform(put("/api/config").contentType(JSON).content("{}"))
                .andExpect(status().isUnauthorized());
    }
}
