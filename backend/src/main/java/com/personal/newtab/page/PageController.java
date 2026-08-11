package com.personal.newtab.page;

import com.personal.newtab.configaggregate.PageResponse;
import com.personal.newtab.user.User;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * Page 写操作端点（见 issue 04 / spec §后端 API 契约）。
 * 页面是一等公民：增/改名/排序/删。非空页删除由 {@link PageService} 阻止（409）。
 */
@RestController
@RequestMapping("/api/pages")
@RequiredArgsConstructor
public class PageController {

    private final PageService pageService;

    @PostMapping
    public PageResponse create(@Valid @RequestBody NameRequest req,
                               @AuthenticationPrincipal User user) {
        return PageResponse.of(pageService.create(user.getId(), req.name().trim()));
    }

    /** 字面子路径，先于 PUT /{id} 匹配。 */
    @PatchMapping("/reorder")
    public List<PageResponse> reorder(@Valid @RequestBody List<PageService.ReorderItem> items,
                                      @AuthenticationPrincipal User user) {
        return pageService.reorder(user.getId(), items).stream().map(PageResponse::of).toList();
    }

    @PutMapping("/{id}")
    public PageResponse rename(@PathVariable Long id,
                               @Valid @RequestBody NameRequest req,
                               @AuthenticationPrincipal User user) {
        return PageResponse.of(pageService.rename(user.getId(), id, req.name().trim()));
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable Long id, @AuthenticationPrincipal User user) {
        pageService.delete(user.getId(), id);
    }

    /** 新建/改名共用：都只带 name（对齐 DB 列 VARCHAR(64)）。 */
    public record NameRequest(
            @NotBlank @Size(max = 64) String name) {
    }
}
