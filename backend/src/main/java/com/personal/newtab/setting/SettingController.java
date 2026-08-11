package com.personal.newtab.setting;

import com.personal.newtab.user.User;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

/**
 * 设置更新（GET 由 /api/config 聚合提供，此处仅 PUT）。
 * theme 限定 light/dark/system。
 */
@RestController
@RequestMapping("/api/settings")
@RequiredArgsConstructor
public class SettingController {

    private final SettingRepository settingRepository;

    @PutMapping
    public SettingResponse update(@Valid @RequestBody SettingRequest req,
                                  @AuthenticationPrincipal User user) {
        Setting s = settingRepository.findById(user.getId()).orElseGet(() -> {
            Setting n = new Setting();
            n.setUserId(user.getId());
            return n;
        });
        s.setTheme(req.theme());
        return SettingResponse.of(settingRepository.save(s));
    }

    public record SettingRequest(@NotBlank @Pattern(regexp = "light|dark|system") String theme) {
    }
}
