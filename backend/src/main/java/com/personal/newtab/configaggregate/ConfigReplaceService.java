package com.personal.newtab.configaggregate;

import com.personal.newtab.auth.DataBootstrap;
import com.personal.newtab.common.OperationConflictException;
import com.personal.newtab.configversion.ConfigVersionService;
import com.personal.newtab.icon.Icon;
import com.personal.newtab.icon.IconRepository;
import com.personal.newtab.icon.IconType;
import com.personal.newtab.icon.Size;
import com.personal.newtab.layoutsetting.LayoutSetting;
import com.personal.newtab.layoutsetting.LayoutSettingRepository;
import com.personal.newtab.layoutsetting.LayoutSettingService;
import com.personal.newtab.page.Page;
import com.personal.newtab.page.PageRepository;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 配置全量替换(ADR-0006)。离线推送(重连后整体 PUT)与导入「完全替换」共用此路径。
 *
 * <p>语义:清空当前 user 的 pages + icons(layout 可选覆盖),按请求 blob 重建并**重新分配 id**,
 * 同事务内 bump config_version。结构校验(缺失/空/长度)由请求记录上的 jakarta 约束 + @Valid → 400;
 * 业务校验(图标孤儿引用 / 每页容量 ≤ {@link DataBootstrap#DEFAULT_CAPACITY_CELLS} / 单例不重复)→ 409。
 * 整体重建天然绕开 id 冲突(离线临时 id / 导出文件 id 本就不权威)。</p>
 */
@Service
@RequiredArgsConstructor
public class ConfigReplaceService {

    private final PageRepository pageRepository;
    private final IconRepository iconRepository;
    private final LayoutSettingRepository layoutSettingRepository;
    private final ConfigVersionService configVersionService;
    private final ConfigAssembler configAssembler;

    @Transactional
    public ConfigResponse replace(Long userId, ReplaceRequest req) {
        validate(req);

        // 1. 全清当前 user 的 icons + pages(layout 单独 upsert)
        iconRepository.deleteAllInBatch(iconRepository.findByUserIdOrderByPageIdAscSortOrderAscIdAsc(userId));
        pageRepository.deleteAllInBatch(pageRepository.findByUserIdOrderBySortOrderAscIdAsc(userId));
        iconRepository.flush();
        pageRepository.flush();

        // 2. 重建 pages,建立 clientPageId → 新 DB id 映射(IDENTITY 立即 INSERT,可取 id)
        Map<Long, Long> pageIdMap = new HashMap<>();
        for (PageItem pi : req.pages()) {
            Page p = new Page();
            p.setUserId(userId);
            p.setName(pi.name());
            p.setSortOrder(pi.sortOrder());
            pageRepository.save(p);
            pageIdMap.put(pi.id(), p.getId());
        }

        // 3. 重建 icons(经 pageIdMap 重定向到新页;忽略入参 id,整体重排)
        for (IconItem ii : req.icons()) {
            Icon ic = new Icon();
            ic.setUserId(userId);
            ic.setPageId(pageIdMap.get(ii.pageId()));
            ic.setType(ii.type());
            ic.setSize(ii.size());
            ic.setSortOrder(ii.sortOrder());
            ic.setData(ii.data());
            iconRepository.save(ic);
        }

        // 4. layout 可选:null 则保留现有行
        if (req.layoutSettings() != null) {
            LayoutSettingService.LayoutSettingRequest li = req.layoutSettings();
            LayoutSetting s = layoutSettingRepository.findByUserId(userId).orElseGet(() -> {
                LayoutSetting n = new LayoutSetting();
                n.setUserId(userId);
                return n;
            });
            s.setGridWidth(li.gridWidth());
            s.setGridGap(li.gridGap());
            s.setIconScale(li.iconScale());
            layoutSettingRepository.save(s);
        }

        // 5. bump 版本 + 回读聚合返回
        configVersionService.touch(userId);
        return configAssembler.read(userId);
    }

    /** 业务校验:图标孤儿引用 / 每页容量 / 单例 → 409。结构校验由 @Valid → 400 负责。 */
    private void validate(ReplaceRequest req) {
        Set<Long> pageIds = req.pages().stream().map(PageItem::id).collect(Collectors.toSet());
        Map<Long, Integer> cellsByPage = new HashMap<>();
        Map<IconType, Integer> singletonCount = new HashMap<>();
        int idx = 0;
        for (IconItem i : req.icons()) {
            if (!pageIds.contains(i.pageId()))
                throw new OperationConflictException(409, "icons[" + idx + "] 引用了不存在的页面:" + i.pageId());
            int used = cellsByPage.merge(i.pageId(), i.size().cells(), Integer::sum);
            if (used > DataBootstrap.DEFAULT_CAPACITY_CELLS)
                throw new OperationConflictException(409, "页面(blob 内 " + i.pageId()
                        + ")容量超过 " + DataBootstrap.DEFAULT_CAPACITY_CELLS + " 格");
            if (i.type().isSingleton() && singletonCount.merge(i.type(), 1, Integer::sum) > 1)
                throw new OperationConflictException(409, "单例类型 " + i.type() + " 出现多次");
            idx++;
        }
    }

    /** 全量替换请求。pages 必填非空、icons 必填;结构校验经 @Valid → 400。layoutSettings 可空(空则保留现有布局)。 */
    public record ReplaceRequest(
            @NotNull @jakarta.validation.constraints.Size(min = 1) @Valid List<PageItem> pages,
            @NotNull @Valid List<IconItem> icons,
            @Valid LayoutSettingService.LayoutSettingRequest layoutSettings) {
    }

    /** blob 内的 page。id 为**客户端键**(可来自服务端,也可为离线临时 id),仅用于被 icons 引用与映射。 */
    public record PageItem(
            @NotNull Long id,
            @NotBlank @jakarta.validation.constraints.Size(max = 64) String name,
            @NotNull Integer sortOrder) {
    }

    /** blob 内的 icon。不接受 id(整体重建重排);pageId 引用 {@link PageItem#id}。type/size 为大写枚举名(对齐 GET 输出)。 */
    public record IconItem(
            @NotNull Long pageId,
            @NotNull IconType type,
            @NotNull Size size,
            @NotNull Integer sortOrder,
            Map<String, Object> data) {
    }
}
