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
import java.util.List;
import java.util.Map;

/**
 * Icon 写操作的业务层（见 issue 04）。承载两个核心约束：
 * <ul>
 *   <li>页面容量（ADR-0002）：目标页 {@code sum(size.cells)} + 新增格子 &gt; {@link DataBootstrap#DEFAULT_CAPACITY_CELLS}
 *       → 409，message 带剩余格数。</li>
 *   <li>单例类型（CONTEXT.md）：{@link IconType#isSingleton()} 且该 user 已有实例 → 409。</li>
 * </ul>
 *
 * <p>跨页与同页移动走同一 {@link #move} 逻辑：目标页重新排序，源页（若不同）补齐连续序号。
 * 所有读/写按 {@code userId} 隔离（单 admin 项目，仍防越权）。
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
        // 1. 目标页归属校验（不属当前 user 视为不存在）
        Page page = pageRepository.findByIdAndUserId(req.pageId(), userId)
                .orElseThrow(() -> new OperationConflictException(404, "页面不存在"));

        // 2. 单例校验
        if (req.type().isSingleton() && iconRepository.existsByUserIdAndType(userId, req.type())) {
            throw new OperationConflictException(409, "该类型图标已存在，且为单例类型");
        }

        // 3. 容量校验
        requireCapacity(userId, page.getId(), req.size().cells(), "页面");

        // 4. 末尾追加（sortOrder = max + 1）
        List<Icon> siblings = iconRepository.findByUserIdAndPageIdOrderBySortOrderAscIdAsc(userId, page.getId());
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
            int delta = req.size().cells() - icon.getSize().cells();
            if (delta > 0) {
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
        Long pageId = icon.getPageId();
        iconRepository.delete(icon);
        // 源页补齐连续序号（删除后中间不再留洞）
        renumber(userId, pageId);
        configVersionService.touch(userId);
    }

    /**
     * 移动/重排（同页与跨页统一）。{@code toIndex} 为目标页内的目标位序（0..n）。
     * 跨页时重新校验目标页容量；同页纯重排不校验容量（占用不变）。
     */
    @Transactional
    public Icon move(Long userId, MoveRequest req) {
        Icon icon = iconRepository.findByIdAndUserId(req.id(), userId)
                .orElseThrow(() -> new OperationConflictException(404, "图标不存在"));
        Page target = pageRepository.findByIdAndUserId(req.toPageId(), userId)
                .orElseThrow(() -> new OperationConflictException(404, "目标页面不存在"));

        boolean crossPage = !icon.getPageId().equals(target.getId());

        if (crossPage) {
            requireCapacity(userId, target.getId(), icon.getSize().cells(), "目标页面");
        }

        Long fromPageId = icon.getPageId();
        // 目标页：先剔除被移动项（同页时含自身），在 toIndex 插入，重排
        List<Icon> targetList = new ArrayList<>(
                iconRepository.findByUserIdAndPageIdOrderBySortOrderAscIdAsc(userId, target.getId()));
        targetList.removeIf(i -> i.getId().equals(icon.getId()));
        int insertAt = Math.max(0, Math.min(req.toIndex(), targetList.size()));
        targetList.add(insertAt, icon);
        renumber(targetList);

        icon.setPageId(target.getId());
        iconRepository.saveAll(targetList);

        // 源页补齐序号
        if (crossPage) {
            renumber(userId, fromPageId);
        }
        configVersionService.touch(userId);
        return icon;
    }

    /** 该页已占用格子之和。 */
    private int cellsUsed(Long userId, Long pageId) {
        return iconRepository.findByUserIdAndPageIdOrderBySortOrderAscIdAsc(userId, pageId).stream()
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

    /** 从库重新读页内图标并重排（删除后补洞用）。 */
    private void renumber(Long userId, Long pageId) {
        renumber(iconRepository.findByUserIdAndPageIdOrderBySortOrderAscIdAsc(userId, pageId));
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

    /** Icon 移动/重排请求。toIndex 为目标页内目标位序。 */
    public record MoveRequest(
            @NotNull Long id,
            @NotNull Long toPageId,
            int toIndex) {
    }
}
