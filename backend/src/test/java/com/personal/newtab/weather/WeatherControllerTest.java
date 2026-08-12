package com.personal.newtab.weather;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;

import static org.mockito.ArgumentMatchers.anyDouble;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * WeatherController 参数绑定回归(standaloneSetup:只测此 controller + mock Service,不连外部、不起完整上下文)。
 *
 * <p>历史 bug:曾用 {@code @RequestParam List<String> location},Spring 的 StringToCollectionConverter 会把
 * 单个 {@code "lat,lon"} 按逗号拆成 {@code ["lat","lon"]},parseLatLon 全失败 → 空响应 {} → 前端「天气刷新失败」。
 * 改用 {@link jakarta.servlet.http.HttpServletRequest#getParameterValues} 修复。本测试锁死「单个 location 值里的
 * 逗号不被拆分」。</p>
 */
class WeatherControllerTest {

    private MockMvc mvc;

    @BeforeEach
    void setup() {
        WeatherService svc = mock(WeatherService.class);
        WeatherBundle.Now now = new WeatherBundle.Now("t", 26, 29, "104", "阴",
                82, "北风", "2", "6", 1003, 30, 0.0);
        when(svc.bundleFor(anyDouble(), anyDouble()))
                .thenReturn(new WeatherBundle("stub", now, null, List.of()));
        mvc = MockMvcBuilders.standaloneSetup(new WeatherController(svc)).build();
    }

    @Test
    void singleLocationWithCommaIsNotSplit() throws Exception {
        // 旧代码(逗号被拆)此处返回 {};修复后 key 存在
        mvc.perform(get("/api/weather").param("location", "39.90499,116.40529"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$['39.90499,116.40529'].now.temp").value(26));
    }

    @Test
    void multipleLocationsEachKeptIntact() throws Exception {
        mvc.perform(get("/api/weather")
                        .param("location", "39.9,116.4")
                        .param("location", "31.2,121.5"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$['39.9,116.4'].now.temp").value(26))
                .andExpect(jsonPath("$['31.2,121.5'].now.temp").value(26));
    }

    @Test
    void noLocationReturnsEmptyMap() throws Exception {
        mvc.perform(get("/api/weather"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$").isEmpty());
    }
}
