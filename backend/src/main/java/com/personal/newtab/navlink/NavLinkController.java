package com.personal.newtab.navlink;

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
 * 导航链接 CRUD（仅 list/create/delete，对齐原型交互；编辑 YAGNI）。
 * 全部按当前登录用户隔离。
 */
@RestController
@RequestMapping("/api/nav-links")
@RequiredArgsConstructor
public class NavLinkController {

    private final NavLinkRepository navLinkRepository;

    @GetMapping
    public List<NavLinkResponse> list(@AuthenticationPrincipal User user) {
        return navLinkRepository.findByUserIdOrderBySortOrderAscIdAsc(user.getId())
                .stream().map(NavLinkResponse::of).toList();
    }

    @PostMapping
    public NavLinkResponse create(@Valid @RequestBody NavLinkRequest req,
                                  @AuthenticationPrincipal User user) {
        NavLink n = new NavLink();
        n.setUserId(user.getId());
        n.setName(req.name().trim());
        n.setUrl(req.url().trim());
        n.setSortOrder(nextSortOrder(user.getId()));
        return NavLinkResponse.of(navLinkRepository.save(n));
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable Long id, @AuthenticationPrincipal User user) {
        // 幂等 + 越权安全：找不到或不属于当前用户一律当已删除
        navLinkRepository.findByIdAndUserId(id, user.getId()).ifPresent(navLinkRepository::delete);
    }

    /** 末尾追加序号。ponytail: O(n) 扫列表求 size，量级个位~几十，无需计数器 */
    private int nextSortOrder(Long userId) {
        return navLinkRepository.findByUserIdOrderBySortOrderAscIdAsc(userId).size();
    }

    /** 仅此处用，内联于控制器，少一个文件 */
    public record NavLinkRequest(
            @NotBlank @Size(max = 64) String name,
            @NotBlank @Size(max = 512) String url) {
    }
}
