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
                .andExpect(jsonPath("$.layoutSettings.iconScale").value(1.0));
    }

    @Test
    @WithUserDetails("admin")
    void putLayoutSettingsPersistsAndShowsUpInConfig() throws Exception {
        mvc.perform(put("/api/layout-settings").contentType(MediaType.APPLICATION_JSON).content("""
                {"gridWidth":1280,"gridGap":12,"iconScale":1.25}
                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.gridWidth").value(1280))
                .andExpect(jsonPath("$.gridGap").value(12))
                .andExpect(jsonPath("$.iconScale").value(1.25));
        // 聚合接口回读确认落库(同账号跨设备共享语义)
        mvc.perform(get("/api/config"))
                .andExpect(jsonPath("$.layoutSettings.gridWidth").value(1280))
                .andExpect(jsonPath("$.layoutSettings.gridGap").value(12))
                .andExpect(jsonPath("$.layoutSettings.iconScale").value(1.25));
    }

    @Test
    @WithUserDetails("admin")
    void rejectOutOfRangeReturns400() throws Exception {
        mvc.perform(put("/api/layout-settings").contentType(MediaType.APPLICATION_JSON).content("""
                {"gridWidth":100,"gridGap":99,"iconScale":3.0}
                """))
                .andExpect(status().isBadRequest());
    }

    @Test
    void putRequiresAuth() throws Exception {
        mvc.perform(put("/api/layout-settings").contentType(MediaType.APPLICATION_JSON).content("""
                {"gridWidth":1024,"gridGap":8,"iconScale":1.0}
                """))
                .andExpect(status().isUnauthorized());
    }
}
