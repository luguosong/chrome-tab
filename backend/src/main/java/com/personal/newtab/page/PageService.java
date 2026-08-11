package com.personal.newtab.page;

import com.personal.newtab.common.OperationConflictException;
import com.personal.newtab.icon.IconRepository;
import jakarta.validation.constraints.NotNull;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * Page 写操作的业务层（见 issue 04）。页面是一等公民：增/改名/排序/删。
 * 删除策略遵循 spec 暂定：非空页返回 409，提示先清空或移走图标。
 */
@Service
@RequiredArgsConstructor
public class PageService {

    private final PageRepository pageRepository;
    private final IconRepository iconRepository;

    @Transactional
    public Page create(Long userId, String name) {
        List<Page> pages = pageRepository.findByUserIdOrderBySortOrderAscIdAsc(userId);
        int nextOrder = pages.isEmpty() ? 0 : pages.get(pages.size() - 1).getSortOrder() + 1;
        Page p = new Page();
        p.setUserId(userId);
        p.setName(name);
        p.setSortOrder(nextOrder);
        return pageRepository.save(p);
    }

    @Transactional
    public Page rename(Long userId, Long id, String name) {
        Page p = pageRepository.findByIdAndUserId(id, userId)
                .orElseThrow(() -> new OperationConflictException(404, "页面不存在"));
        p.setName(name);
        return pageRepository.save(p);
    }

    @Transactional
    public void delete(Long userId, Long id) {
        Page p = pageRepository.findByIdAndUserId(id, userId)
                .orElseThrow(() -> new OperationConflictException(404, "页面不存在"));
        if (iconRepository.existsByPageId(p.getId())) {
            throw new OperationConflictException(409, "该页非空，请先移动或删除页内图标");
        }
        pageRepository.delete(p);
    }

    /** 批量重排。仅本 user 的 page 会被更新；不存在的 id 静默跳过（前端始终基于最新列表提交）。 */
    @Transactional
    public List<Page> reorder(Long userId, List<ReorderItem> items) {
        List<Page> pages = pageRepository.findByUserIdOrderBySortOrderAscIdAsc(userId);
        for (Page p : pages) {
            items.stream().filter(it -> it.id().equals(p.getId())).findFirst()
                    .ifPresent(it -> p.setSortOrder(it.sortOrder()));
        }
        return pageRepository.saveAll(pages);
    }

    public record ReorderItem(
            @NotNull Long id,
            int sortOrder) {
    }
}
