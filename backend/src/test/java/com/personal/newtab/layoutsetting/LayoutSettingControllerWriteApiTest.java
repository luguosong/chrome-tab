package com.personal.newtab.layoutsetting;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.test.context.support.WithUserDetails;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 布局设置写 API(spec §接缝1)。无行时聚合接口回退默认值;PUT 持久化后聚合接口可见;
 * 越界由 jakarta 校验 + GlobalExceptionHandler → 400。每测 @Transactional 回滚。
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class LayoutSettingControllerWriteApiTest {

    @Autowired private MockMvc mvc;

    @Test
    @WithUserDetails("admin")
    void getConfigReturnsDefaultLayoutWhenNoRow() throws Exception {
        mvc.perform(get("/api/config"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.layoutSettings.gridWidth").value(1024))
                .andExpect(jsonPath("$.layoutSettings.gridGap").value(8))
                .andExpect(jsonPath("$.layoutSettings.gridGapY").value(8))
                .andExpect(jsonPath("$.layoutSettings.iconScale").value(1.0))
                .andExpect(jsonPath("$.layoutSettings.panelFog").value(36))
                .andExpect(jsonPath("$.layoutSettings.searchBarWidth").value(576))
                .andExpect(jsonPath("$.layoutSettings.searchBarVisible").value(true))
                .andExpect(jsonPath("$.layoutSettings.searchEngine").value("google"))
                .andExpect(jsonPath("$.layoutSettings.clockVisible").value(true))
                .andExpect(jsonPath("$.layoutSettings.clockFont").value(48))
                .andExpect(jsonPath("$.layoutSettings.clock24h").value(true))
                .andExpect(jsonPath("$.layoutSettings.labelVisible").value(true))
                .andExpect(jsonPath("$.layoutSettings.labelSize").value(12))
                .andExpect(jsonPath("$.layoutSettings.labelColor").value("#ffffff"));
    }

    @Test
    @WithUserDetails("admin")
    void putLayoutSettingsPersistsAndShowsUpInConfig() throws Exception {
        mvc.perform(put("/api/layout-settings").contentType(MediaType.APPLICATION_JSON).content("""
                {"gridWidth":1280,"gridGap":12,"gridGapY":16,"iconScale":1.25,
                 "panelFog":20,"searchBarWidth":720,"searchBarVisible":false,"searchEngine":"bing",
                 "clockVisible":false,"clockFont":56,"clock24h":false,
                 "labelVisible":false,"labelSize":14,"labelColor":"#ffd700"}
                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.gridWidth").value(1280))
                .andExpect(jsonPath("$.gridGap").value(12))
                .andExpect(jsonPath("$.gridGapY").value(16))
                .andExpect(jsonPath("$.iconScale").value(1.25))
                .andExpect(jsonPath("$.panelFog").value(20))
                .andExpect(jsonPath("$.searchBarWidth").value(720))
                .andExpect(jsonPath("$.searchBarVisible").value(false))
                .andExpect(jsonPath("$.searchEngine").value("bing"))
                .andExpect(jsonPath("$.clockVisible").value(false))
                .andExpect(jsonPath("$.clockFont").value(56))
                .andExpect(jsonPath("$.clock24h").value(false))
                .andExpect(jsonPath("$.labelVisible").value(false))
                .andExpect(jsonPath("$.labelSize").value(14))
                .andExpect(jsonPath("$.labelColor").value("#ffd700"));
        // 聚合接口回读确认落库(同账号跨设备共享语义)
        mvc.perform(get("/api/config"))
                .andExpect(jsonPath("$.layoutSettings.gridWidth").value(1280))
                .andExpect(jsonPath("$.layoutSettings.gridGap").value(12))
                .andExpect(jsonPath("$.layoutSettings.gridGapY").value(16))
                .andExpect(jsonPath("$.layoutSettings.iconScale").value(1.25))
                .andExpect(jsonPath("$.layoutSettings.panelFog").value(20))
                .andExpect(jsonPath("$.layoutSettings.searchEngine").value("bing"))
                .andExpect(jsonPath("$.layoutSettings.labelColor").value("#ffd700"));
    }

    /** 旧客户端/旧备份只带三字段的 PUT 仍被接受,新字段落默认值(双向兼容)。 */
    @Test
    @WithUserDetails("admin")
    void putWithLegacyThreeFieldsFallsBackToDefaults() throws Exception {
        mvc.perform(put("/api/layout-settings").contentType(MediaType.APPLICATION_JSON).content("""
                {"gridWidth":1024,"gridGap":8,"iconScale":1.0}
                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.gridGapY").value(8))
                .andExpect(jsonPath("$.panelFog").value(36))
                .andExpect(jsonPath("$.searchEngine").value("google"))
                .andExpect(jsonPath("$.labelColor").value("#ffffff"));
    }

    @Test
    @WithUserDetails("admin")
    void rejectOutOfRangeReturns400() throws Exception {
        mvc.perform(put("/api/layout-settings").contentType(MediaType.APPLICATION_JSON).content("""
                {"gridWidth":100,"gridGap":99,"gridGapY":99,"iconScale":3.0,"panelFog":99,
                 "searchBarWidth":99,"clockFont":99,"labelSize":99,"labelColor":"notahex","searchEngine":"duckduckgo"}
                """))
                .andExpect(status().isBadRequest());
    }

    @Test
    void putRequiresAuth() throws Exception {
        mvc.perform(put("/api/layout-settings").contentType(MediaType.APPLICATION_JSON).content("""
                {"gridWidth":1024,"gridGap":8,"gridGapY":8,"iconScale":1.0}
                """))
                .andExpect(status().isUnauthorized());
    }
}
