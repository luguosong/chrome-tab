package com.personal.newtab.icon;

import com.personal.newtab.configaggregate.IconResponse;
import com.personal.newtab.user.User;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * Icon 写操作端点（见 issue 04 / spec §后端 API 契约）。
 * 容量校验、单例校验、跨页移动重排由 {@link IconService} 强制执行。
 */
@RestController
@RequestMapping("/api/icons")
@RequiredArgsConstructor
public class IconController {

    private final IconService iconService;

    @PostMapping
    public IconResponse create(@Valid @RequestBody IconService.CreateRequest req,
                               @AuthenticationPrincipal User user) {
        return IconResponse.of(iconService.create(user.getId(), req));
    }

    /** 字面子路径，先于 PATCH /{id} 匹配（Spring Boot 3 PathPattern 无歧义）。 */
    @PatchMapping("/move")
    public IconResponse move(@Valid @RequestBody IconService.MoveRequest req,
                             @AuthenticationPrincipal User user) {
        return IconResponse.of(iconService.move(user.getId(), req));
    }

    /** 建组（ADR-0011）：memberIds 有序，首位=被拖图标、末位=悬停目标（组行继承其 sort_order）。返回新组行。 */
    @PostMapping("/merge")
    public IconResponse merge(@Valid @RequestBody IconService.MergeRequest req,
                              @AuthenticationPrincipal User user) {
        return IconResponse.of(iconService.merge(user.getId(), req));
    }

    /** 解散分组：成员按保留 size 自组位置洒回本页；容量不足 409。成功 200 无体（前端 invalidate 聚合重拉）。 */
    @PostMapping("/{id}/dissolve")
    public void dissolve(@PathVariable Long id,
                         @AuthenticationPrincipal User user) {
        iconService.dissolve(user.getId(), id);
    }

    @PatchMapping("/{id}")
    public IconResponse update(@PathVariable Long id,
                               @RequestBody IconService.UpdateRequest req,
                               @AuthenticationPrincipal User user) {
        return IconResponse.of(iconService.update(user.getId(), id, req));
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable Long id, @AuthenticationPrincipal User user) {
        iconService.delete(user.getId(), id);
    }
}
