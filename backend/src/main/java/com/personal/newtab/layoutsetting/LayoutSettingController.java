package com.personal.newtab.layoutsetting;

import com.personal.newtab.user.User;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

/**
 * 布局设置写端点。读端点经聚合接口 GET /api/config 的 layoutSettings 字段下发。
 * 跨设备共享:设置按 user_id 持久化,同一账号任一设备登录即读同一行。
 */
@RestController
@RequestMapping("/api/layout-settings")
@RequiredArgsConstructor
public class LayoutSettingController {

    private final LayoutSettingService layoutSettingService;

    @PutMapping
    public LayoutSettingResponse update(@Valid @RequestBody LayoutSettingService.LayoutSettingRequest req,
                                        @AuthenticationPrincipal User user) {
        return layoutSettingService.update(user.getId(), req);
    }
}
