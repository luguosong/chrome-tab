package com.personal.newtab.icon;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface IconRepository extends JpaRepository<Icon, Long> {

    List<Icon> findByUserIdOrderByPageIdAscSortOrderAscIdAsc(Long userId);

    List<Icon> findByPageIdOrderBySortOrderAscIdAsc(Long pageId);

    /** 单例校验：该 user 是否已有某 type 实例。 */
    boolean existsByUserIdAndType(Long userId, IconType type);

    /** 非空页判断：该页是否还有图标。 */
    boolean existsByPageId(Long pageId);

    /** 越权安全：按 id+user 查；不属于当前 user 视为不存在。 */
    Optional<Icon> findByIdAndUserId(Long id, Long userId);

    /** 按页加载（含 user 维度，避免越权），按 sortOrder、id 稳定排序。 */
    List<Icon> findByUserIdAndPageIdOrderBySortOrderAscIdAsc(Long userId, Long pageId);

    /** 页面顶层序列（ADR-0011）：该页 parent_id IS NULL 的行，容量与页序计算用。 */
    List<Icon> findByUserIdAndPageIdAndParentIdIsNullOrderBySortOrderAscIdAsc(Long userId, Long pageId);

    /** 组内序列：同 parent_id 的成员行，每组独立 0..n。 */
    List<Icon> findByUserIdAndParentIdOrderBySortOrderAscIdAsc(Long userId, Long parentId);
}
