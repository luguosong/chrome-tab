package com.personal.newtab.configaggregate;

import com.personal.newtab.user.User;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

/**
 * 配置聚合接口。
 * <ul>
 *   <li>GET /api/config:一次取齐 pages/icons/layoutSettings + updatedAt(整体配置版本,ADR-0006)。</li>
 *   <li>PUT /api/config:全量替换——离线重连推送与导入「完全替换」共用(见 {@link ConfigReplaceService})。</li>
 * </ul>
 * 装配统一经 {@link ConfigAssembler},避免 GET 与 PUT 回读两处拼装漂移。
 */
@RestController
@RequestMapping("/api/config")
@RequiredArgsConstructor
public class ConfigController {

    private final ConfigAssembler configAssembler;
    private final ConfigReplaceService configReplaceService;

    @GetMapping
    public ConfigResponse get(@AuthenticationPrincipal User user) {
        return configAssembler.read(user.getId());
    }

    @PutMapping
    public ConfigResponse replace(@Valid @RequestBody ConfigReplaceService.ReplaceRequest req,
                                  @AuthenticationPrincipal User user) {
        return configReplaceService.replace(user.getId(), req);
    }
}
