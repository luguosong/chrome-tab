package com.personal.newtab.configaggregate;

import com.personal.newtab.icon.IconRepository;
import com.personal.newtab.page.PageRepository;
import com.personal.newtab.setting.SettingResponse;
import com.personal.newtab.setting.SettingRepository;
import com.personal.newtab.user.User;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/config")
@RequiredArgsConstructor
public class ConfigController {

    private final SettingRepository settingRepository;
    private final PageRepository pageRepository;
    private final IconRepository iconRepository;

    @GetMapping
    public ConfigResponse get(@AuthenticationPrincipal User user) {
        Long uid = user.getId();
        var pages = pageRepository.findByUserIdOrderBySortOrderAscIdAsc(uid)
                .stream().map(PageResponse::of).toList();
        var icons = iconRepository.findByUserIdOrderByPageIdAscSortOrderAscIdAsc(uid)
                .stream().map(IconResponse::of).toList();
        var setting = settingRepository.findById(uid)
                .map(SettingResponse::of).orElse(new SettingResponse("system"));
        return new ConfigResponse(pages, icons, setting);
    }
}
