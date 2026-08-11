package com.personal.newtab.page;

import com.personal.newtab.icon.IconRepository;
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
 * Page 写 API 测试（见 issue 04 / spec §接缝1）。
 *
 * <p>种子 5 页（sortOrder 0..4）。非空页删除由 PageService 阻止（409）；
 * 新建页 sortOrder 末尾追加。每测 @Transactional 回滚。</p>
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class PageControllerWriteApiTest {

    @Autowired private MockMvc mvc;
    @Autowired private PageRepository pageRepository;
    @Autowired private IconRepository iconRepository;

    @Test
    @WithUserDetails("admin")
    void createPageAppendsAtEnd() throws Exception {
        mvc.perform(post("/api/pages").contentType(MediaType.APPLICATION_JSON).content("""
                {"name":"新页"}
                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").exists())
                .andExpect(jsonPath("$.name").value("新页"))
                .andExpect(jsonPath("$.sortOrder").value(5));   // 已有 5 页(0..4)，追加到 5
    }

    @Test
    @WithUserDetails("admin")
    void renamePageSucceeds() throws Exception {
        Page target = pageRepository.findAll().get(0);
        mvc.perform(put("/api/pages/" + target.getId()).contentType(MediaType.APPLICATION_JSON).content("""
                {"name":"改名后"}
                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("改名后"));
    }

    @Test
    @WithUserDetails("admin")
    void renameUnknownPageReturns404() throws Exception {
        mvc.perform(put("/api/pages/999999").contentType(MediaType.APPLICATION_JSON).content("""
                {"name":"x"}
                """))
                .andExpect(status().isNotFound());
    }

    @Test
    @WithUserDetails("admin")
    void deleteEmptyPageSucceeds() throws Exception {
        // 新建一个空页再删
        Page empty = new Page();
        empty.setUserId(1L);
        empty.setName("临时空页");
        empty.setSortOrder(99);
        empty = pageRepository.save(empty);

        mvc.perform(delete("/api/pages/" + empty.getId()))
                .andExpect(status().isNoContent());
        assertThat(pageRepository.findById(empty.getId())).isEmpty();
    }

    @Test
    @WithUserDetails("admin")
    void deleteNonEmptyPageReturns409() throws Exception {
        // 快速导航页有 12 nav 图标 → 非空
        Page nav = pageRepository.findAll().stream()
                .filter(p -> p.getName().equals("快速导航")).findFirst().orElseThrow();
        mvc.perform(delete("/api/pages/" + nav.getId()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.status").value(409))
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("非空")));
    }

    @Test
    @WithUserDetails("admin")
    void reorderPagesUpdatesSortOrders() throws Exception {
        List<Page> pages = pageRepository.findByUserIdOrderBySortOrderAscIdAsc(1L);
        // 反转顺序
        StringBuilder body = new StringBuilder("[");
        for (int i = 0; i < pages.size(); i++) {
            if (i > 0) body.append(',');
            // 原 last → sortOrder 0，原 first → sortOrder 最后
            Page p = pages.get(pages.size() - 1 - i);
            body.append("{\"id\":").append(p.getId()).append(",\"sortOrder\":").append(i).append("}");
        }
        body.append("]");

        mvc.perform(patch("/api/pages/reorder").contentType(MediaType.APPLICATION_JSON).content(body.toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(pages.size()));

        List<Page> after = pageRepository.findByUserIdOrderBySortOrderAscIdAsc(1L);
        assertThat(after.get(0).getId()).isEqualTo(pages.get(pages.size() - 1).getId());
        for (int i = 0; i < after.size(); i++) {
            assertThat(after.get(i).getSortOrder()).isEqualTo(i);
        }
    }

    @Test
    void writeEndpointsRequireAuth() throws Exception {
        mvc.perform(post("/api/pages").contentType(MediaType.APPLICATION_JSON).content("""
                {"name":"x"}
                """))
                .andExpect(status().isUnauthorized());
    }
}
