package com.personal.newtab.icon;

import com.personal.newtab.page.Page;
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

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Icon 写 API 测试（见 issue 04 / spec §接缝1）。
 *
 * <p>沿用 ConfigControllerTest 的接缝约定：{@code @Transactional} 每测回滚；
 * 上下文启动时已 seed（12 nav small + 1 changelog large + 13 stock medium，分布在 5 页）。
 * 种子页占用：nav=12 格、changelog=6 格、stock 各页 6/6/1 只 medium=24/24/4 格。</p>
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class IconControllerWriteApiTest {

    @Autowired private MockMvc mvc;
    @Autowired private PageRepository pageRepository;
    @Autowired private IconRepository iconRepository;

    private Page pageByName(String name) {
        return pageRepository.findAll().stream()
                .filter(p -> p.getName().equals(name)).findFirst().orElseThrow();
    }

    // ---------- POST /api/icons 成功路径 ----------

    @Test
    @WithUserDetails("admin")
    void createNavIconOnNavPageSucceeds() throws Exception {
        Page nav = pageByName("快速导航");
        String body = """
                {"pageId":%d,"type":"NAV","size":"SMALL","data":{"name":"Test","url":"https://test.com"}}
                """.formatted(nav.getId());
        mvc.perform(post("/api/icons").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").exists())
                .andExpect(jsonPath("$.pageId").value(nav.getId()))
                .andExpect(jsonPath("$.type").value("NAV"))
                .andExpect(jsonPath("$.size").value("SMALL"))
                .andExpect(jsonPath("$.data.name").value("Test"))
                .andExpect(jsonPath("$.sortOrder").value(12));   // 12 nav 之后追加
    }

    @Test
    @WithUserDetails("admin")
    void createMediumIconOnChangelogPageSucceeds() throws Exception {
        // changelog 页仅 1 个 large(6 格)，余 18 格，medium(4) 能放
        Page cl = pageByName("日志更新");
        String body = """
                {"pageId":%d,"type":"STOCK","size":"MEDIUM","data":{"symbol":"usTEST","name":"测试"}}
                """.formatted(cl.getId());
        mvc.perform(post("/api/icons").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.size").value("MEDIUM"))
                .andExpect(jsonPath("$.sortOrder").value(1));   // 1 个 changelog 之后
    }

    // ---------- 容量超限 409 ----------

    @Test
    @WithUserDetails("admin")
    void createIconOnFullPageReturns409WithRemainingCells() throws Exception {
        // 行情页：6 只 medium = 24 格，已满
        Page stock = pageByName("行情");
        String body = """
                {"pageId":%d,"type":"STOCK","size":"MEDIUM","data":{"symbol":"usNEW","name":"新"}}
                """.formatted(stock.getId());
        mvc.perform(post("/api/icons").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.status").value(409))
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("剩余 0 格")));
    }

    @Test
    @WithUserDetails("admin")
    void createLargeIconWhenNotEnoughRemainingReturns409() throws Exception {
        // nav 页 12 small = 12 格占用，余 12 格。加 2 个 large(各 6 格) → 余 0，第 3 个 large(6) 需 > 0 → 409
        Page nav = pageByName("快速导航");
        for (int i = 0; i < 2; i++) {
            String b = """
                    {"pageId":%d,"type":"NAV","size":"LARGE","data":{"name":"L%d","url":"https://x.com"}}
                    """.formatted(nav.getId(), i);
            mvc.perform(post("/api/icons").contentType(MediaType.APPLICATION_JSON).content(b))
                    .andExpect(status().isOk());
        }
        String over = """
                {"pageId":%d,"type":"NAV","size":"LARGE","data":{"name":"L2","url":"https://x.com"}}
                """.formatted(nav.getId());
        mvc.perform(post("/api/icons").contentType(MediaType.APPLICATION_JSON).content(over))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("剩余 0 格")));
    }

    // ---------- 单例重复 409 ----------

    @Test
    @WithUserDetails("admin")
    void createSecondChangelogReturns409Singleton() throws Exception {
        Page nav = pageByName("快速导航");
        String body = """
                {"pageId":%d,"type":"CHANGELOG","size":"LARGE","data":null}
                """.formatted(nav.getId());
        mvc.perform(post("/api/icons").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.status").value(409))
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("单例")));
    }

    // ---------- 不存在的页 404 ----------

    @Test
    @WithUserDetails("admin")
    void createWithUnknownPageReturns404() throws Exception {
        String body = """
                {"pageId":999999,"type":"NAV","size":"SMALL","data":{"name":"x","url":"https://x.com"}}
                """;
        mvc.perform(post("/api/icons").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isNotFound());
    }

    // ---------- PATCH /api/icons/{id} ----------

    @Test
    @WithUserDetails("admin")
    void updateIconSizeShrinkSucceedsNoCapacityCheck() throws Exception {
        // changelog 的 large → medium（缩小不触发容量校验）
        Icon cl = iconRepository.findAll().stream()
                .filter(i -> i.getType() == IconType.CHANGELOG).findFirst().orElseThrow();
        String body = """
                {"size":"MEDIUM"}
                """;
        mvc.perform(patch("/api/icons/" + cl.getId()).contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.size").value("MEDIUM"));
    }

    @Test
    @WithUserDetails("admin")
    void updateIconSizeGrowSucceedsWhenCapacityAllows() throws Exception {
        // nav 页 12 small = 12 格占用，余 12。把其中一只 small→medium(+3) → 仍余 9，放得下
        Icon nav0 = iconRepository.findAll().stream()
                .filter(i -> i.getType() == IconType.NAV).findFirst().orElseThrow();
        mvc.perform(patch("/api/icons/" + nav0.getId()).contentType(MediaType.APPLICATION_JSON).content("""
                {"size":"MEDIUM"}
                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.size").value("MEDIUM"));
    }

    @Test
    @WithUserDetails("admin")
    void updateIconSizeGrowRejectWhenOverCapacity() throws Exception {
        // 行情页已满（24 格）。把其中一只 medium 改 large（+2 格）→ 409
        Page stock = pageByName("行情");
        Icon first = iconRepository.findByPageIdOrderBySortOrderAscIdAsc(stock.getId()).get(0);
        String body = """
                {"size":"LARGE"}
                """;
        mvc.perform(patch("/api/icons/" + first.getId()).contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("剩余 0 格")));
    }

    @Test
    @WithUserDetails("admin")
    void updateIconDataReplacesDataField() throws Exception {
        // PATCH 提供 data 时整体覆盖该字段（非逐 key 合并）
        Icon nav = iconRepository.findAll().stream()
                .filter(i -> i.getType() == IconType.NAV).findFirst().orElseThrow();
        String body = """
                {"data":{"name":"新名","url":"https://new.com"}}
                """;
        mvc.perform(patch("/api/icons/" + nav.getId()).contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.name").value("新名"))
                .andExpect(jsonPath("$.data.url").value("https://new.com"));
    }

    @Test
    @WithUserDetails("admin")
    void updateUnknownIconReturns404() throws Exception {
        mvc.perform(patch("/api/icons/999999").contentType(MediaType.APPLICATION_JSON).content("""
                {"size":"SMALL"}
                """))
                .andExpect(status().isNotFound());
    }

    // ---------- DELETE /api/icons/{id} ----------

    @Test
    @WithUserDetails("admin")
    void deleteIconSucceedsAndRenumbers() throws Exception {
        Icon nav0 = iconRepository.findAll().stream()
                .filter(i -> i.getType() == IconType.NAV)
                .reduce((a, b) -> b).orElseThrow();  // 取最后一个（sortOrder 最大）
        Long pageId = nav0.getPageId();
        mvc.perform(delete("/api/icons/" + nav0.getId()))
                .andExpect(status().isNoContent());
        // 删除后页内序号应连续 0..n-1
        List<Icon> remaining = iconRepository.findByPageIdOrderBySortOrderAscIdAsc(pageId);
        assertThat(remaining).hasSize(11);
        for (int i = 0; i < remaining.size(); i++) {
            assertThat(remaining.get(i).getSortOrder()).isEqualTo(i);
        }
    }

    @Test
    @WithUserDetails("admin")
    void deleteUnknownIconReturns404() throws Exception {
        mvc.perform(delete("/api/icons/999999"))
                .andExpect(status().isNotFound());
    }

    // ---------- PATCH /api/icons/move ----------

    @Test
    @WithUserDetails("admin")
    void moveIconSamePageReorder() throws Exception {
        Page nav = pageByName("快速导航");
        List<Icon> icons = iconRepository.findByPageIdOrderBySortOrderAscIdAsc(nav.getId());
        Long last = icons.get(icons.size() - 1).getId();   // 末位
        String body = """
                {"id":%d,"toPageId":%d,"toIndex":0}
                """.formatted(last, nav.getId());
        mvc.perform(patch("/api/icons/move").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sortOrder").value(0));
        // 校验整体连续
        List<Icon> after = iconRepository.findByPageIdOrderBySortOrderAscIdAsc(nav.getId());
        assertThat(after.get(0).getId()).isEqualTo(last);
        for (int i = 0; i < after.size(); i++) {
            assertThat(after.get(i).getSortOrder()).isEqualTo(i);
        }
    }

    @Test
    @WithUserDetails("admin")
    void moveIconCrossPageSucceedsWhenCapacityAllows() throws Exception {
        // changelog 页（余 18 格）能容纳从 nav 页移过来的 1 个 small
        Page nav = pageByName("快速导航");
        Page cl = pageByName("日志更新");
        Icon mover = iconRepository.findByPageIdOrderBySortOrderAscIdAsc(nav.getId()).get(0);
        String body = """
                {"id":%d,"toPageId":%d,"toIndex":0}
                """.formatted(mover.getId(), cl.getId());
        mvc.perform(patch("/api/icons/move").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.pageId").value(cl.getId()))
                .andExpect(jsonPath("$.sortOrder").value(0));
        // 源页数量 -1，目标页 +1
        assertThat(iconRepository.findByPageIdOrderBySortOrderAscIdAsc(nav.getId())).hasSize(11);
        assertThat(iconRepository.findByPageIdOrderBySortOrderAscIdAsc(cl.getId())).hasSize(2);
        // 源页序号连续
        List<Icon> src = iconRepository.findByPageIdOrderBySortOrderAscIdAsc(nav.getId());
        for (int i = 0; i < src.size(); i++) {
            assertThat(src.get(i).getSortOrder()).isEqualTo(i);
        }
    }

    @Test
    @WithUserDetails("admin")
    void moveIconCrossPageRejectWhenTargetFull() throws Exception {
        // 试图把 changelog(large,6 格) 移到已满的 stock 页（余 0）→ 409
        Page stock = pageByName("行情");
        Icon changelog = iconRepository.findAll().stream()
                .filter(i -> i.getType() == IconType.CHANGELOG).findFirst().orElseThrow();
        String body = """
                {"id":%d,"toPageId":%d,"toIndex":0}
                """.formatted(changelog.getId(), stock.getId());
        mvc.perform(patch("/api/icons/move").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("目标页面容量不足")));
    }

    @Test
    void writeEndpointsRequireAuth() throws Exception {
        // 无 session → 401（证明写端点受 SecurityConfig 保护）
        mvc.perform(post("/api/icons").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isUnauthorized());
    }
}
