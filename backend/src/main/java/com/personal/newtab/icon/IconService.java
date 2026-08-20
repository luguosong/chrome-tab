package com.personal.newtab.icon;

import com.personal.newtab.auth.DataBootstrap;
import com.personal.newtab.common.OperationConflictException;
import com.personal.newtab.configversion.ConfigVersionService;
import com.personal.newtab.page.Page;
import com.personal.newtab.page.PageRepository;
import jakarta.validation.constraints.NotNull;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Icon 写操作的业务层（见 issue 04）。承载核心约束：
 * <ul>
 *   <li>页面容量（ADR-0002）：目标页 {@code sum(size.cells)} + 新增格子 &gt; {@link DataBootstrap#DEFAULT_CAPACITY_CELLS}
 *       → 409，message 带剩余格数。分组（ADR-0011）修订：只计页面<b>顶层</b>行（组行按其
 *       {@code size=SMALL} 占 1 格），组内成员不计容量、自身 size 保留，移出时按保留 size 计入。</li>
 *   <li>单例类型（CONTEXT.md）：{@link IconType#isSingleton()} 且该 user 已有实例 → 409。</li>
 *   <li>分组（ADR-0011）：组行只能经 {@link #merge} 创建；<b>空组不存活</b>——任何路径使组变空
 *       都在事务内自动删组行；含成员的组行 DELETE → 409「先解散」。</li>
 * </ul>
 *
 * <p>跨页与同页移动走同一 {@link #move} 逻辑：目标页重新排序，源页（若不同）补齐连续序号。
 * 序列分两层：页面顶层序列（{@code parent_id IS NULL}）与组内序列（同 {@code parent_id} 行），
 * 各自独立 0..n。所有读/写按 {@code userId} 隔离（单 admin 项目，仍防越权）。
 * 任意写都在事务末尾 bump config_version(ADR-0006)，使前端镜像能据 updatedAt 和解。</p>
 */
@Service
@RequiredArgsConstructor
public class IconService {

    private final IconRepository iconRepository;
    private final PageRepository pageRepository;
    private final ConfigVersionService configVersionService;

    @Transactional
    public Icon create(Long userId, CreateRequest req) {
        // 0. 组行只能经 merge 产生（空组不存活，直接 POST 会造出无成员组）
        if (req.type() == IconType.GROUP) {
            throw new OperationConflictException(409, "分组需经合并创建，不能直接新建");
        }

        // 1. 目标页归属校验（不属当前 user 视为不存在）
        Page page = pageRepository.findByIdAndUserId(req.pageId(), userId)
                .orElseThrow(() -> new OperationConflictException(404, "页面不存在"));

        // 2. 单例校验
        if (req.type().isSingleton() && iconRepository.existsByUserIdAndType(userId, req.type())) {
            throw new OperationConflictException(409, "该类型图标已存在，且为单例类型");
        }

        // 3. 容量校验（只计顶层行；新图标总在顶层）
        requireCapacity(userId, page.getId(), req.size().cells(), "页面");

        // 4. 末尾追加（sortOrder = max + 1）
        List<Icon> siblings = topLevel(userId, page.getId());
        int nextOrder = siblings.isEmpty() ? 0 : siblings.get(siblings.size() - 1).getSortOrder() + 1;

        Icon icon = new Icon();
        icon.setUserId(userId);
        icon.setPageId(page.getId());
        icon.setType(req.type());
        icon.setSize(req.size());
        icon.setSortOrder(nextOrder);
        icon.setData(req.data());
        Icon saved = iconRepository.save(icon);
        configVersionService.touch(userId);
        return saved;
    }

    @Transactional
    public Icon update(Long userId, Long id, UpdateRequest req) {
        Icon icon = iconRepository.findByIdAndUserId(id, userId)
                .orElseThrow(() -> new OperationConflictException(404, "图标不存在"));

        // 改 size 时重新校验容量（差值 > 0 才需校验：缩小不触发）
        if (req.size() != null && req.size() != icon.getSize()) {
            if (icon.getType() == IconType.GROUP) {
                throw new OperationConflictException(409, "分组不可更改尺寸");
            }
            int delta = req.size().cells() - icon.getSize().cells();
            // 组内成员不占页面容量：免校验（移出分组时才按保留 size 计入）
            if (icon.getParentId() == null && delta > 0) {
                requireCapacity(userId, icon.getPageId(), delta, "页面");
            }
            icon.setSize(req.size());
        }
        // data 仅在提供时覆盖（部分更新；null 表示不动）
        if (req.data() != null) {
            icon.setData(req.data());
        }
        Icon updated = iconRepository.save(icon);
        configVersionService.touch(userId);
        return updated;
    }

    @Transactional
    public void delete(Long userId, Long id) {
        Icon icon = iconRepository.findByIdAndUserId(id, userId)
                .orElseThrow(() -> new OperationConflictException(404, "图标不存在"));

        if (icon.getType() == IconType.GROUP) {
            // FK RESTRICT 防误删兜底在 DB 层；服务层前置校验把 500 转成可读 409
            if (!iconRepository.findByUserIdAndParentIdOrderBySortOrderAscIdAsc(userId, icon.getId()).isEmpty()) {
                throw new OperationConflictException(409, "分组内还有图标，请先解散分组");
            }
            Long pageId = icon.getPageId();
            iconRepository.delete(icon);
            renumber(userId, pageId);
        } else if (icon.getParentId() != null) {
            // 删成员：组内补洞；组因此变空 → 空组不存活，连带删组行（子行先删，父行后删）
            Long groupId = icon.getParentId();
            Long groupPageId = iconRepository.findByIdAndUserId(groupId, userId).map(Icon::getPageId).orElse(null);
            iconRepository.delete(icon);
            iconRepository.flush();
            List<Icon> rest = iconRepository.findByUserIdAndParentIdOrderBySortOrderAscIdAsc(userId, groupId);
            if (rest.isEmpty()) {
                iconRepository.findByIdAndUserId(groupId, userId).ifPresent(iconRepository::delete);
                if (groupPageId != null) renumber(userId, groupPageId);
            } else {
                renumber(rest);
            }
        } else {
            Long pageId = icon.getPageId();
            iconRepository.delete(icon);
            renumber(userId, pageId);
        }
        configVersionService.touch(userId);
    }

    /**
     * 移动/重排（同页与跨页统一），分组语义三分支（ADR-0011）：
     * <ul>
     *   <li>组行自身：普通 1 格顶层图标；跨页移动时事务内同步成员行 page_id（组内序保留）。</li>
     *   <li>{@code parentId != null}：入组 / 组内重排。入组恒落组内序列末尾（忽略 toIndex）；
     *       组内重排按 toIndex 夹紧。只有 NAV 可入组，目标必须是组行。</li>
     *   <li>{@code parentId == null}：落页面序列。原在组内则按保留 size 计入目标页容量；
     *       源组因此变空则事务内自动删组行。</li>
     * </ul>
     */
    @Transactional
    public Icon move(Long userId, MoveRequest req) {
        Icon icon = iconRepository.findByIdAndUserId(req.id(), userId)
                .orElseThrow(() -> new OperationConflictException(404, "图标不存在"));

        // ── 分支一：组行自身移动（不可入组：无嵌套）──────────────────────────
        if (icon.getType() == IconType.GROUP) {
            if (req.parentId() != null) {
                throw new OperationConflictException(409, "分组不能嵌套入组");
            }
            Page target = requirePage(userId, req.toPageId());
            boolean crossPage = !icon.getPageId().equals(target.getId());
            if (crossPage) {
                requireCapacity(userId, target.getId(), 1, "目标页面");
            }
            Long fromPageId = icon.getPageId();
            List<Icon> seq = topLevel(userId, target.getId());
            seq.removeIf(i -> i.getId().equals(icon.getId()));
            seq.add(clamp(req.toIndex(), seq.size()), icon);
            renumber(seq);
            icon.setPageId(target.getId());
            if (crossPage) {
                renumber(userId, fromPageId);
                // 组跨页：事务内同步成员行 page_id（成员不计目标页容量，组内 sortOrder 保留）
                List<Icon> members = iconRepository.findByUserIdAndParentIdOrderBySortOrderAscIdAsc(userId, icon.getId());
                for (Icon m : members) {
                    m.setPageId(target.getId());
                }
                iconRepository.saveAll(members);
            }
            configVersionService.touch(userId);
            return icon;
        }

        // ── 分支二：入组 / 组内重排 ─────────────────────────────────────────
        if (req.parentId() != null) {
            if (icon.getType() != IconType.NAV) {
                throw new OperationConflictException(409, "只有网站链接图标可加入分组");
            }
            Icon group = iconRepository.findByIdAndUserId(req.parentId(), userId)
                    .orElseThrow(() -> new OperationConflictException(404, "目标分组不存在"));
            if (group.getType() != IconType.GROUP) {
                throw new OperationConflictException(409, "parentId 指向的不是分组");
            }
            boolean alreadyInside = req.parentId().equals(icon.getParentId());
            if (!alreadyInside) {
                // 离开原位置：原组（移出，空则删组行）或原页顶层序列（补洞）
                if (icon.getParentId() != null) {
                    removeFromGroup(userId, icon);
                } else {
                    // 此刻 icon 仍在源页顶层（parentId 尚未落库），补洞需显式剔除自身，否则序号留洞
                    List<Icon> src = topLevel(userId, icon.getPageId());
                    src.removeIf(i -> i.getId().equals(icon.getId()));
                    renumber(src);
                }
            }
            List<Icon> seq = iconRepository.findByUserIdAndParentIdOrderBySortOrderAscIdAsc(userId, group.getId());
            seq.removeIf(i -> i.getId().equals(icon.getId()));
            // 入组恒落组内序列末尾（忽略 toIndex）；组内重排按 toIndex 夹紧
            int insertAt = alreadyInside ? clamp(req.toIndex(), seq.size()) : seq.size();
            seq.add(insertAt, icon);
            renumber(seq);
            icon.setPageId(group.getPageId());
            icon.setParentId(group.getId());
            configVersionService.touch(userId);
            return icon;
        }

        // ── 分支三：落页面序列（顶层）────────────────────────────────────────
        Page target = requirePage(userId, req.toPageId());
        boolean wasInGroup = icon.getParentId() != null;
        boolean crossPage = !icon.getPageId().equals(target.getId());
        // 同页顶层纯重排不校验容量（占用不变）；跨页、或从组内移出（保留 size 开始占格）才校验
        if (crossPage || wasInGroup) {
            int needed = icon.getSize().cells();
            if (wasInGroup && !crossPage) {
                // 同页移出且源组因此变空：组行让出 1 格，净占 size-1（对齐 dissolve 的 -1）
                List<Icon> siblings = iconRepository.findByUserIdAndParentIdOrderBySortOrderAscIdAsc(
                        userId, icon.getParentId());
                if (siblings.size() == 1) needed -= 1;
            }
            requireCapacity(userId, target.getId(), needed, "目标页面");
        }
        if (wasInGroup) {
            removeFromGroup(userId, icon);
        }
        Long fromPageId = icon.getPageId();
        List<Icon> seq = topLevel(userId, target.getId());
        seq.removeIf(i -> i.getId().equals(icon.getId()));
        seq.add(clamp(req.toIndex(), seq.size()), icon);
        renumber(seq);
        icon.setPageId(target.getId());
        icon.setParentId(null);
        if (crossPage && !wasInGroup) {
            // 组内成员的源「页」顶层序列本就不含它，无需补洞
            renumber(userId, fromPageId);
        }
        configVersionService.touch(userId);
        return icon;
    }

    /**
     * 建组（ADR-0011）。{@code memberIds} 有序：首位 = 被拖图标 A、末位 = 悬停目标 B。
     * 事务内：建组行（type=group / size=small / data={"name":"新建分组"}，**继承 B 的 sort_order**）
     * + 成员挂 parent_id（组内序 0..n-1 按 memberIds 序）+ 页面序列在 B 原位换成组行、成员位置补洞重排。
     * 校验违者 409：成员 ≥2、全 NAV、全在该页顶层（组行 / 已入组 / 跨页均拒）。
     */
    @Transactional
    public Icon merge(Long userId, MergeRequest req) {
        Page page = pageRepository.findByIdAndUserId(req.pageId(), userId)
                .orElseThrow(() -> new OperationConflictException(404, "页面不存在"));
        List<Long> memberIds = req.memberIds();
        if (memberIds == null || memberIds.size() < 2) {
            throw new OperationConflictException(409, "合并成分组至少需要 2 个图标");
        }
        Set<Long> memberSet = new HashSet<>(memberIds);
        if (memberSet.size() != memberIds.size()) {
            throw new OperationConflictException(409, "成员存在重复");
        }

        List<Icon> topLevel = topLevel(userId, page.getId());
        Map<Long, Icon> topById = new HashMap<>();
        for (Icon i : topLevel) topById.put(i.getId(), i);
        List<Icon> members = new ArrayList<>();
        for (Long mid : memberIds) {
            Icon m = topById.get(mid);
            // 覆盖三种违例：不在本页（跨页/不存在）、组行、已入组图标（不在顶层集内）
            if (m == null || m.getType() != IconType.NAV) {
                throw new OperationConflictException(409, "成员必须都是本页顶层的网站链接图标");
            }
            members.add(m);
        }

        // 组行继承末位成员（悬停目标 B）的 sort_order：在序列里 B 的位置放组、其余成员位置消失
        Icon group = new Icon();
        group.setUserId(userId);
        group.setPageId(page.getId());
        group.setType(IconType.GROUP);
        group.setSize(Size.SMALL);
        group.setSortOrder(0);
        group.setData(Map.of("name", "新建分组"));
        group = iconRepository.save(group);

        Long lastId = memberIds.get(memberIds.size() - 1);
        List<Icon> seq = new ArrayList<>();
        for (Icon i : topLevel) {
            if (memberSet.contains(i.getId())) {
                if (i.getId().equals(lastId)) seq.add(group);
                // 其余成员脱离页面序列（组行占了它们的位置）
            } else {
                seq.add(i);
            }
        }
        renumber(seq);

        for (int k = 0; k < members.size(); k++) {
            Icon m = members.get(k);
            m.setParentId(group.getId());
            m.setSortOrder(k);   // 组内序按 memberIds 顺序 0..n-1
        }
        iconRepository.saveAll(members);

        configVersionService.touch(userId);
        return group;
    }

    /**
     * 解散分组：成员按各自保留 size 自组行 sort_order 位置起、按组内序洒回本页顶层。
     * 容量不足 409（message 提示先移出部分图标）；组行删除。
     */
    @Transactional
    public void dissolve(Long userId, Long groupId) {
        Icon group = iconRepository.findByIdAndUserId(groupId, userId)
                .orElseThrow(() -> new OperationConflictException(404, "分组不存在"));
        if (group.getType() != IconType.GROUP) {
            throw new OperationConflictException(409, "该图标不是分组");
        }
        List<Icon> members = iconRepository.findByUserIdAndParentIdOrderBySortOrderAscIdAsc(userId, group.getId());
        int memberCells = members.stream().mapToInt(m -> m.getSize().cells()).sum();
        // 组行自身让出 1 格；成员按保留 size 落回顶层
        if (cellsUsed(userId, group.getPageId()) - 1 + memberCells > DataBootstrap.DEFAULT_CAPACITY_CELLS) {
            throw new OperationConflictException(409, "页面容量不足，请先移出部分图标后再解散");
        }

        List<Icon> seq = new ArrayList<>();
        for (Icon i : topLevel(userId, group.getPageId())) {
            if (i.getId().equals(group.getId())) {
                seq.addAll(members);   // 自组位置起按组内序展开
            } else {
                seq.add(i);
            }
        }
        for (Icon m : members) {
            m.setParentId(null);
        }
        // 先落库解除成员引用再删组行（生产 FK RESTRICT：顺序颠倒会 500）
        iconRepository.saveAll(members);
        iconRepository.flush();
        iconRepository.delete(group);
        renumber(seq);
        configVersionService.touch(userId);
    }

    /** 把 icon 移出其所属组：组内补洞重排；组因此变空则删组行（空组不存活）。调用方负责设置新归属。 */
    private void removeFromGroup(Long userId, Icon icon) {
        Long groupId = icon.getParentId();
        List<Icon> members = iconRepository.findByUserIdAndParentIdOrderBySortOrderAscIdAsc(userId, groupId);
        members.removeIf(m -> m.getId().equals(icon.getId()));
        if (members.isEmpty()) {
            // 先解除子行引用（防生产 FK RESTRICT），再删空组行
            icon.setParentId(null);
            iconRepository.saveAndFlush(icon);
            iconRepository.findByIdAndUserId(groupId, userId).ifPresent(iconRepository::delete);
        } else {
            renumber(members);
        }
    }

    private Page requirePage(Long userId, Long pageId) {
        return pageRepository.findByIdAndUserId(pageId, userId)
                .orElseThrow(() -> new OperationConflictException(404, "目标页面不存在"));
    }

    private static int clamp(int v, int max) {
        return Math.max(0, Math.min(v, max));
    }

    /** 页面顶层序列（parent_id IS NULL）。 */
    private List<Icon> topLevel(Long userId, Long pageId) {
        return iconRepository.findByUserIdAndPageIdAndParentIdIsNullOrderBySortOrderAscIdAsc(userId, pageId);
    }

    /** 该页已占用格子之和（只计顶层行；组内成员不计，ADR-0011）。 */
    private int cellsUsed(Long userId, Long pageId) {
        return topLevel(userId, pageId).stream()
                .mapToInt(i -> i.getSize().cells()).sum();
    }

    /**
     * 容量校验：若页内已用格子 + {@code needed} 超过 {@link DataBootstrap#DEFAULT_CAPACITY_CELLS}，
     * 抛 409，message 带剩余格数。{@code subject} 用于消息前缀（"页面"/"目标页面"）。
     */
    private void requireCapacity(Long userId, Long pageId, int needed, String subject) {
        int remaining = DataBootstrap.DEFAULT_CAPACITY_CELLS - cellsUsed(userId, pageId);
        if (needed > remaining) {
            throw new OperationConflictException(409, subject + "容量不足，剩余 " + remaining + " 格");
        }
    }

    /** 按列表顺序重排 sortOrder 为 0..n-1 并保存。 */
    private void renumber(List<Icon> list) {
        for (int i = 0; i < list.size(); i++) {
            list.get(i).setSortOrder(i);
        }
        iconRepository.saveAll(list);
    }

    /** 从库重新读页内顶层图标并重排（删除后补洞用）。 */
    private void renumber(Long userId, Long pageId) {
        renumber(topLevel(userId, pageId));
    }

    /** Icon 新建请求。 */
    public record CreateRequest(
            @NotNull Long pageId,
            @NotNull IconType type,
            @NotNull Size size,
            Map<String, Object> data) {
    }

    /** Icon 部分更新请求；size/data 均可为 null（表示不改）。 */
    public record UpdateRequest(Size size, Map<String, Object> data) {
    }

    /** Icon 移动/重排请求。toIndex 为目标页内目标位序；parentId 可空——null=落页面序列、非空=目标组行。 */
    public record MoveRequest(
            @NotNull Long id,
            @NotNull Long toPageId,
            int toIndex,
            Long parentId) {
    }

    /** 建组请求。memberIds 有序：首位 = 被拖图标、末位 = 悬停目标（组行继承其位置）。 */
    public record MergeRequest(
            @NotNull Long pageId,
            @NotNull List<Long> memberIds) {
    }
}
