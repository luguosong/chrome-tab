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
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * 分组(ADR-0011)契约测试:merge / dissolve / move(parentId 三态) / DELETE 空组不存活 /
 * cellsUsed 只计顶层 / PUT wire 的组语义在 {@link com.personal.newtab.configaggregate.ConfigReplaceControllerTest}。
 *
 * <p>沿用 {@link IconControllerWriteApiTest} 的接缝约定:{@code @Transactional} 每测回滚;
 * 上下文启动时已 seed(nav 页 12 NAV SMALL=12 格 / 日志页 1 CHANGELOG LARGE=6 格 / 行情页 13 STOCK MEDIUM=52 格)。
 * 容量类测试用 {@link #addMediumFillers} 或直造 NAV 行调整基线。</p>
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class IconGroupWriteApiTest {

    @Autowired private MockMvc mvc;
    @Autowired private PageRepository pageRepository;
    @Autowired private IconRepository iconRepository;

    private Page pageByName(String name) {
        return pageRepository.findAll().stream()
                .filter(p -> p.getName().equals(name)).findFirst().orElseThrow();
    }

    private Page navPage() {
        return pageByName("快速导航");
    }

    /** nav 页顶层 NAV 图标(按序);index 即种子 sortOrder。 */
    private Icon navIcon(int idx) {
        return iconRepository.findByUserIdAndPageIdAndParentIdIsNullOrderBySortOrderAscIdAsc(
                        navPage().getUserId(), navPage().getId()).stream()
                .filter(i -> i.getType() == IconType.NAV).toList().get(idx);
    }

    /** 直接经仓库向 page 追加 n 个填充图标(绕过容量校验,每图标 1 格),把页补到指定占用以测 409。 */
    private void addFillers(Page page, int n) {
        Long uid = page.getUserId();
        List<Icon> existing = iconRepository.findByUserIdAndPageIdOrderBySortOrderAscIdAsc(uid, page.getId());
        int nextOrder = existing.isEmpty() ? 0 : existing.get(existing.size() - 1).getSortOrder() + 1;
        for (int i = 0; i < n; i++) {
            Icon f = new Icon();
            f.setUserId(uid);
            f.setPageId(page.getId());
            f.setType(IconType.STOCK);
            f.setSortOrder(nextOrder + i);
            f.setData(Map.of("symbol", "fill" + i, "name", "填充" + i));
            iconRepository.save(f);
        }
    }

    /** 直造一个顶层 NAV 行(绕过容量),返回受管实体。 */
    private Icon makeNav(Page page) {
        Icon f = new Icon();
        f.setUserId(page.getUserId());
        f.setPageId(page.getId());
        f.setType(IconType.NAV);
        f.setSortOrder(999);
        f.setData(Map.of("name", "造", "url", "https://made.up"));
        return iconRepository.save(f);
    }

    /** 经 API 把两个 nav 图标 merge 成组(常用前置),返回组行 id。 */
    private Long mergeViaApi(Page page, Icon a, Icon... rest) throws Exception {
        StringBuilder ids = new StringBuilder("[" + a.getId());
        for (Icon i : rest) ids.append(',').append(i.getId());
        ids.append(']');
        String body = "{\"pageId\":%d,\"memberIds\":%s}".formatted(page.getId(), ids);
        String resp = mvc.perform(post("/api/icons/merge").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return Long.parseLong(resp.replaceAll(".*\"id\":(\\d+).*", "$1"));
    }

    // ---------- POST /api/icons/merge ----------

    @Test
    @WithUserDetails("admin")
    void mergeCreatesGroupInheritingTargetPositionAndDetachesMembers() throws Exception {
        Page nav = navPage();
        Icon a = navIcon(0);   // 被拖图标
        Icon b = navIcon(5);   // 悬停目标(组行继承其位置)
        Long groupId = mergeViaApi(nav, a, b);

        Icon group = iconRepository.findById(groupId).orElseThrow();
        assertThat(group.getType()).isEqualTo(IconType.GROUP);
        assertThat(group.getParentId()).isNull();
        assertThat(group.getData()).containsEntry("name", "新建分组");
        // 组落 B 的视觉位:A(在 B 前)消失后序列补洞,B 原位 5 前移为 4
        assertThat(group.getSortOrder()).isEqualTo(4);

        // 成员挂 parent_id,组内序按 memberIds 顺序 0..n-1
        assertThat(a.getParentId()).isEqualTo(groupId);
        assertThat(a.getSortOrder()).isZero();
        assertThat(b.getParentId()).isEqualTo(groupId);
        assertThat(b.getSortOrder()).isEqualTo(1);

        // 页面序列:成员脱离、组行落 B 原位,顶层序号连续 0..10
        List<Icon> top = iconRepository.findByUserIdAndPageIdAndParentIdIsNullOrderBySortOrderAscIdAsc(
                nav.getUserId(), nav.getId());
        assertThat(top).hasSize(11);
        assertThat(top.get(4).getId()).isEqualTo(groupId);
        for (int i = 0; i < top.size(); i++) {
            assertThat(top.get(i).getSortOrder()).isEqualTo(i);
        }
    }

    @Test
    @WithUserDetails("admin")
    void mergeRejectsInvalidMemberships() throws Exception {
        Page nav = navPage();
        // <2 成员
        mvc.perform(post("/api/icons/merge").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"pageId\":%d,\"memberIds\":[%d]}".formatted(nav.getId(), navIcon(0).getId())))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("至少")));
        // 含非 NAV(changelog,同时在别的页)
        Icon changelog = iconRepository.findAll().stream()
                .filter(i -> i.getType() == IconType.CHANGELOG).findFirst().orElseThrow();
        mvc.perform(post("/api/icons/merge").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"pageId\":%d,\"memberIds\":[%d,%d]}".formatted(
                                nav.getId(), navIcon(0).getId(), changelog.getId())))
                .andExpect(status().isConflict());
        // 跨页 NAV:先移一个 nav 到日志页(顶层),再以 nav 页身份 merge
        Page cl = pageByName("日志更新");
        Icon moved = navIcon(1);
        mvc.perform(patch("/api/icons/move").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"id\":%d,\"toPageId\":%d,\"toIndex\":0}".formatted(moved.getId(), cl.getId())))
                .andExpect(status().isOk());
        mvc.perform(post("/api/icons/merge").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"pageId\":%d,\"memberIds\":[%d,%d]}".formatted(
                                nav.getId(), navIcon(0).getId(), moved.getId())))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("顶层")));
    }

    @Test
    @WithUserDetails("admin")
    void mergeRejectsGroupRowOrAlreadyGroupedMember() throws Exception {
        Page nav = navPage();
        Icon a = navIcon(0);
        Icon other = navIcon(2);   // merge 前取好引用
        Long groupId = mergeViaApi(nav, a, navIcon(1));
        // 组行自身作成员
        mvc.perform(post("/api/icons/merge").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"pageId\":%d,\"memberIds\":[%d,%d]}".formatted(
                                nav.getId(), other.getId(), groupId)))
                .andExpect(status().isConflict());
        // 已入组图标作成员(不在顶层序列)
        mvc.perform(post("/api/icons/merge").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"pageId\":%d,\"memberIds\":[%d,%d]}".formatted(
                                nav.getId(), a.getId(), other.getId())))
                .andExpect(status().isConflict());
    }

    @Test
    @WithUserDetails("admin")
    void createGroupTypeDirectlyReturns409() throws Exception {
        // 空组不存活:组行只能经 merge 产生
        Page nav = navPage();
        mvc.perform(post("/api/icons").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"pageId\":%d,\"type\":\"GROUP\",\"data\":null}"
                                .formatted(nav.getId())))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("合并")));
    }

    // ---------- POST /api/icons/{id}/dissolve ----------

    @Test
    @WithUserDetails("admin")
    void dissolveScattersMembersFromGroupPosition() throws Exception {
        Page nav = navPage();
        Icon a = navIcon(0);   // 原 sortOrder 0
        Icon b = navIcon(1);   // 原 sortOrder 1(组落此位)
        Icon third = navIcon(2);   // merge 前取好引用(navIcon 在 merge 后会漂移)
        Long groupId = mergeViaApi(nav, a, b);

        mvc.perform(post("/api/icons/%d/dissolve".formatted(groupId)))
                .andExpect(status().isOk());

        // 组行删除;成员洒回组位置(组内序),parentId 清空
        assertThat(iconRepository.findById(groupId)).isEmpty();
        assertThat(a.getParentId()).isNull();
        assertThat(b.getParentId()).isNull();
        List<Icon> top = iconRepository.findByUserIdAndPageIdAndParentIdIsNullOrderBySortOrderAscIdAsc(
                nav.getUserId(), nav.getId());
        assertThat(top).hasSize(12);   // 全员归位
        // 组落 B 视觉位 0(成员都在组位前被移除),成员按组内序自 0 展开:third 顺移到 2
        assertThat(top.get(0).getId()).isEqualTo(a.getId());
        assertThat(top.get(1).getId()).isEqualTo(b.getId());
        assertThat(top.get(2).getId()).isEqualTo(third.getId());
        for (int i = 0; i < top.size(); i++) {
            assertThat(top.get(i).getSortOrder()).isEqualTo(i);
        }
    }

    @Test
    @WithUserDetails("admin")
    void dissolveRejectsWhenCapacityInsufficient() throws Exception {
        // merge 释放的格被新图标占掉 → dissolve 洒回超容量 → 409(每图标 1 格)
        Page nav = navPage();
        addFillers(nav, 52);   // 12 + 52 = 64 格
        Long groupId = mergeViaApi(nav, navIcon(0), navIcon(1));   // 64-2+1=63,余 1
        for (int i = 0; i < 1; i++) {
            mvc.perform(post("/api/icons").contentType(MediaType.APPLICATION_JSON)
                            .content("{\"pageId\":%d,\"type\":\"STOCK\",\"data\":{\"symbol\":\"s%d\",\"name\":\"s\"}}"
                                    .formatted(nav.getId(), i)))
                    .andExpect(status().isOk());   // 吃满到 64
        }
        mvc.perform(post("/api/icons/%d/dissolve".formatted(groupId)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("先移出部分图标")));
        // 组未被解散
        assertThat(iconRepository.findById(groupId)).isPresent();
    }

    @Test
    @WithUserDetails("admin")
    void dissolveNonGroupReturns409() throws Exception {
        Icon nav0 = navIcon(0);
        mvc.perform(post("/api/icons/%d/dissolve".formatted(nav0.getId())))
                .andExpect(status().isConflict());
    }

    // ---------- PATCH /api/icons/move:parentId 三态 ----------

    @Test
    @WithUserDetails("admin")
    void moveIntoGroupAppendsAtEndIgnoringToIndex() throws Exception {
        Page nav = navPage();
        Icon newcomer = navIcon(2);   // merge 前取好(组外顶层 NAV)
        Long groupId = mergeViaApi(nav, navIcon(0), navIcon(1));
        // toIndex=0 应被忽略:入组恒落组内序列末尾
        mvc.perform(patch("/api/icons/move").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"id\":%d,\"toPageId\":%d,\"toIndex\":0,\"parentId\":%d}"
                                .formatted(newcomer.getId(), nav.getId(), groupId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.parentId").value(groupId))
                .andExpect(jsonPath("$.sortOrder").value(2));   // 组内末尾

        List<Icon> members = iconRepository.findByUserIdAndParentIdOrderBySortOrderAscIdAsc(
                nav.getUserId(), groupId);
        assertThat(members).hasSize(3);
        assertThat(members.get(2).getId()).isEqualTo(newcomer.getId());
        // newcomer 脱离页面序列,顶层连续
        List<Icon> top = iconRepository.findByUserIdAndPageIdAndParentIdIsNullOrderBySortOrderAscIdAsc(
                nav.getUserId(), nav.getId());
        assertThat(top).hasSize(10);
        for (int i = 0; i < top.size(); i++) {
            assertThat(top.get(i).getSortOrder()).isEqualTo(i);
        }
    }

    @Test
    @WithUserDetails("admin")
    void moveWithinGroupReordersByClampedIndex() throws Exception {
        Page nav = navPage();
        Icon a = navIcon(0);
        Icon b = navIcon(1);
        Icon c = navIcon(2);
        Long groupId = mergeViaApi(nav, a, b, c);   // 组内序 a=0,b=1,c=2

        // toIndex=99 夹紧到末位
        mvc.perform(patch("/api/icons/move").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"id\":%d,\"toPageId\":%d,\"toIndex\":99,\"parentId\":%d}"
                                .formatted(a.getId(), nav.getId(), groupId)))
                .andExpect(status().isOk());

        List<Icon> members = iconRepository.findByUserIdAndParentIdOrderBySortOrderAscIdAsc(
                nav.getUserId(), groupId);
        assertThat(members).extracting(Icon::getId).containsExactly(b.getId(), c.getId(), a.getId());
        for (int i = 0; i < members.size(); i++) {
            assertThat(members.get(i).getSortOrder()).isEqualTo(i);
        }
    }

    @Test
    @WithUserDetails("admin")
    void moveIntoGroupRejectsNonNavAndNonGroupTarget() throws Exception {
        Page nav = navPage();
        Long groupId = mergeViaApi(nav, navIcon(0), navIcon(1));
        // 非 NAV 入组(stock)
        Icon stock = iconRepository.findAll().stream()
                .filter(i -> i.getType() == IconType.STOCK).findFirst().orElseThrow();
        mvc.perform(patch("/api/icons/move").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"id\":%d,\"toPageId\":%d,\"toIndex\":0,\"parentId\":%d}"
                                .formatted(stock.getId(), nav.getId(), groupId)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("网站链接")));
        // parentId 指向非组行(nav 图标)
        mvc.perform(patch("/api/icons/move").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"id\":%d,\"toPageId\":%d,\"toIndex\":0,\"parentId\":%d}"
                                .formatted(navIcon(2).getId(), nav.getId(), navIcon(3).getId())))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("不是分组")));
    }

    @Test
    @WithUserDetails("admin")
    void moveOutOfGroupSucceedsAndDeletesEmptyGroup() throws Exception {
        Page nav = navPage();
        Icon a = navIcon(0);
        Icon b = navIcon(1);   // merge 前取好引用
        Long groupId = mergeViaApi(nav, a, b);

        // 移出到本页顶层,落 toIndex
        mvc.perform(patch("/api/icons/move").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"id\":%d,\"toPageId\":%d,\"toIndex\":0,\"parentId\":null}"
                                .formatted(a.getId(), nav.getId())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.parentId").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.sortOrder").value(0));
        assertThat(a.getParentId()).isNull();

        // 移出末个成员 → 组空 → 组行自动删除(空组不存活)
        mvc.perform(patch("/api/icons/move").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"id\":%d,\"toPageId\":%d,\"toIndex\":1,\"parentId\":null}"
                                .formatted(b.getId(), nav.getId())))
                .andExpect(status().isOk());
        assertThat(iconRepository.findById(groupId)).isEmpty();
        List<Icon> top = iconRepository.findByUserIdAndPageIdAndParentIdIsNullOrderBySortOrderAscIdAsc(
                nav.getUserId(), nav.getId());
        assertThat(top).hasSize(12);
        for (int i = 0; i < top.size(); i++) {
            assertThat(top.get(i).getSortOrder()).isEqualTo(i);
        }
    }

    @Test
    @WithUserDetails("admin")
    void moveOutOfGroupRejectsWhenTargetFull() throws Exception {
        // 页满(余 0)时组内成员移出到顶层 → 409(组里还有另一成员,组不空)
        Page nav = navPage();
        Icon a = navIcon(0);
        addFillers(nav, 51);   // 12+51=63,余 1
        Long groupId = mergeViaApi(nav, a, navIcon(1), navIcon(2));   // 63-3+1=61,余 3
        mvc.perform(post("/api/icons").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"pageId\":%d,\"type\":\"STOCK\",\"data\":{\"symbol\":\"x\",\"name\":\"x\"}}"
                                .formatted(nav.getId())))
                .andExpect(status().isOk());
        mvc.perform(post("/api/icons").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"pageId\":%d,\"type\":\"STOCK\",\"data\":{\"symbol\":\"y\",\"name\":\"y\"}}"
                                .formatted(nav.getId())))
                .andExpect(status().isOk());   // 63,余 1
        mvc.perform(post("/api/icons").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"pageId\":%d,\"type\":\"STOCK\",\"data\":{\"symbol\":\"z\",\"name\":\"z\"}}"
                                .formatted(nav.getId())))
                .andExpect(status().isOk());   // 吃满 64,余 0
        mvc.perform(patch("/api/icons/move").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"id\":%d,\"toPageId\":%d,\"toIndex\":0,\"parentId\":null}"
                                .formatted(a.getId(), nav.getId())))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("剩余 0 格")));
        assertThat(iconRepository.findById(groupId)).isPresent();   // 组未变空
    }

    @Test
    @WithUserDetails("admin")
    void moveGroupRowCrossPageSyncsMemberPageIds() throws Exception {
        Page nav = navPage();
        Page cl = pageByName("日志更新");
        Icon a = navIcon(0);
        Icon b = navIcon(1);
        Long groupId = mergeViaApi(nav, a, b);

        // 组行自身移动 = 普通 1 格图标;跨页同步成员 page_id
        mvc.perform(patch("/api/icons/move").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"id\":%d,\"toPageId\":%d,\"toIndex\":0,\"parentId\":null}"
                                .formatted(groupId, cl.getId())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.pageId").value(cl.getId()))
                .andExpect(jsonPath("$.sortOrder").value(0));

        Icon group = iconRepository.findById(groupId).orElseThrow();
        assertThat(group.getPageId()).isEqualTo(cl.getId());
        List<Icon> members = iconRepository.findByUserIdAndParentIdOrderBySortOrderAscIdAsc(
                nav.getUserId(), groupId);
        assertThat(members).hasSize(2);
        for (Icon m : members) {
            assertThat(m.getPageId()).isEqualTo(cl.getId());   // 成员行同步
            assertThat(m.getParentId()).isEqualTo(groupId);    // 归属保留
        }
        assertThat(members).extracting(Icon::getSortOrder).containsExactly(0, 1);   // 组内序保留
        // 源页顶层补洞连续
        List<Icon> top = iconRepository.findByUserIdAndPageIdAndParentIdIsNullOrderBySortOrderAscIdAsc(
                nav.getUserId(), nav.getId());
        assertThat(top).hasSize(10);
        for (int i = 0; i < top.size(); i++) {
            assertThat(top.get(i).getSortOrder()).isEqualTo(i);
        }
    }

    @Test
    @WithUserDetails("admin")
    void moveGroupRowIntoGroupReturns409() throws Exception {
        Page nav = navPage();
        Long g1 = mergeViaApi(nav, navIcon(0), navIcon(1));
        Long g2 = mergeViaApi(nav, navIcon(2), navIcon(3));
        mvc.perform(patch("/api/icons/move").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"id\":%d,\"toPageId\":%d,\"toIndex\":0,\"parentId\":%d}"
                                .formatted(g1, nav.getId(), g2)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("嵌套")));
    }

    // ---------- DELETE / 空组不存活 ----------

    @Test
    @WithUserDetails("admin")
    void deleteGroupWithMembersReturns409() throws Exception {
        Page nav = navPage();
        Long groupId = mergeViaApi(nav, navIcon(0), navIcon(1));
        mvc.perform(delete("/api/icons/" + groupId))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("先解散")));
    }

    @Test
    @WithUserDetails("admin")
    void deleteLastMemberRemovesEmptyGroup() throws Exception {
        Page nav = navPage();
        Icon a = navIcon(0);
        Icon b = navIcon(1);   // merge 前取好引用
        Long groupId = mergeViaApi(nav, a, b);

        mvc.perform(delete("/api/icons/" + a.getId())).andExpect(status().isNoContent());
        assertThat(iconRepository.findById(groupId)).isPresent();   // 还剩 1 成员,组存活
        List<Icon> rest = iconRepository.findByUserIdAndParentIdOrderBySortOrderAscIdAsc(
                nav.getUserId(), groupId);
        assertThat(rest).hasSize(1);
        assertThat(rest.get(0).getSortOrder()).isZero();   // 组内补洞

        mvc.perform(delete("/api/icons/" + b.getId())).andExpect(status().isNoContent());
        assertThat(iconRepository.findById(groupId)).isEmpty();   // 空组不存活
    }

    @Test
    @WithUserDetails("admin")
    void moveOutOfGroupCountsReleasedGroupCellWhenGroupEmpties() throws Exception {
        // 组只剩 1 个成员,页满(余 0):移出净占 1-1=0 ≤ 0 → 放行
        // (若不扣组行让出的 1 格:1 > 0 → 409,本测即失败;对齐 dissolve 的 -1 语义)
        Page nav = navPage();
        Icon a = navIcon(0);
        Icon b = navIcon(1);
        Icon c = navIcon(2);   // merge 前取好引用
        addFillers(nav, 51);   // 12 + 51 = 63,余 1
        Long groupId = mergeViaApi(nav, a, b, c);   // 63-3+1=61,余 3
        mvc.perform(patch("/api/icons/move").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"id\":%d,\"toPageId\":%d,\"toIndex\":0,\"parentId\":null}"
                                .formatted(b.getId(), nav.getId())))
                .andExpect(status().isOk());   // 62,余 2
        mvc.perform(patch("/api/icons/move").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"id\":%d,\"toPageId\":%d,\"toIndex\":0,\"parentId\":null}"
                                .formatted(c.getId(), nav.getId())))
                .andExpect(status().isOk());   // 63,余 1
        mvc.perform(post("/api/icons").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"pageId\":%d,\"type\":\"STOCK\",\"data\":{\"symbol\":\"q\",\"name\":\"q\"}}"
                                .formatted(nav.getId())))
                .andExpect(status().isOk());   // 吃满 64,余 0
        // a 移出:净 1-1=0 ≤ 余 0 → 200,组空自动删
        mvc.perform(patch("/api/icons/move").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"id\":%d,\"toPageId\":%d,\"toIndex\":0,\"parentId\":null}"
                                .formatted(a.getId(), nav.getId())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.parentId").value(org.hamcrest.Matchers.nullValue()));
        assertThat(iconRepository.findById(groupId)).isEmpty();   // 空组不存活
    }

    // ---------- cellsUsed 只计顶层行(组 = 1 格) ----------

    @Test
    @WithUserDetails("admin")
    void mergeFreesCapacityForNewIcon() throws Exception {
        // 行情页种子 13,补 49 到 62;直造 2 个 NAV 到 64(满)→ create 409;
        // merge 两个 NAV 成组(2 格 → 1 格,释放 1 格)→ create 成功
        Page stock = pageByName("行情");
        addFillers(stock, 49);   // 13+49=62
        Icon m1 = makeNav(stock);
        Icon m2 = makeNav(stock);   // 62+2=64,满
        mvc.perform(post("/api/icons").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"pageId\":%d,\"type\":\"STOCK\",\"data\":{\"symbol\":\"z\",\"name\":\"z\"}}"
                                .formatted(stock.getId())))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("剩余 0 格")));

        mergeViaApi(stock, m1, m2);   // 64-2+1=63,余 1
        mvc.perform(post("/api/icons").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"pageId\":%d,\"type\":\"STOCK\",\"data\":{\"symbol\":\"z\",\"name\":\"z\"}}"
                                .formatted(stock.getId())))
                .andExpect(status().isOk());
    }
}
