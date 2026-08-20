package com.personal.newtab.configaggregate;

import com.personal.newtab.auth.DataBootstrap;
import com.personal.newtab.common.OperationConflictException;
import com.personal.newtab.configversion.ConfigVersionService;
import com.personal.newtab.icon.Icon;
import com.personal.newtab.icon.IconRepository;
import com.personal.newtab.icon.IconType;
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
import java.util.HashSet;
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
    private final LayoutSettingService layoutSettingService;
    private final ConfigVersionService configVersionService;
    private final ConfigAssembler configAssembler;

    @Transactional
    public ConfigResponse replace(Long userId, ReplaceRequest req) {
        validate(req);

        // 1. 全清当前 user 的 icons + pages(layout 单独 upsert)。parent FK 是 RESTRICT(ADR-0011),
        //    必须**先删 parent_id 非空行(成员)、再删顶层行(含组行)**——单条全删语句会撞 FK 500。
        List<Icon> oldIcons = iconRepository.findByUserIdOrderByPageIdAscSortOrderAscIdAsc(userId);
        iconRepository.deleteAllInBatch(oldIcons.stream().filter(i -> i.getParentId() != null).toList());
        iconRepository.deleteAllInBatch(oldIcons.stream().filter(i -> i.getParentId() == null).toList());
        iconRepository.flush();
        pageRepository.deleteAllInBatch(pageRepository.findByUserIdOrderBySortOrderAscIdAsc(userId));
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

        // 3. 重建 icons:先顶层行(建 clientIconId → 新 DB id 映射),再成员行(经两个 map 重定向;
        //    组行先落库,成员的 parent FK 才有目标可指)
        Map<Long, Long> iconIdMap = new HashMap<>();
        for (IconItem ii : req.icons()) {
            if (ii.parentId() != null) continue;
            Icon ic = insertIcon(userId, ii, pageIdMap, null);
            iconIdMap.put(ii.id(), ic.getId());
        }
        for (IconItem ii : req.icons()) {
            if (ii.parentId() == null) continue;
            insertIcon(userId, ii, pageIdMap, iconIdMap.get(ii.parentId()));
        }

        // 4. layout 可选:null 则保留现有行(复用 LayoutSettingService 的 upsert:新字段
        //    null→默认值映射只有这一处,与本服务的整建语义一致)
        if (req.layoutSettings() != null) {
            layoutSettingService.update(userId, req.layoutSettings());
        }

        // 5. bump 版本 + 回读聚合返回
        configVersionService.touch(userId);
        return configAssembler.read(userId);
    }

    /** 业务校验:图标孤儿引用 / 每页容量(只计顶层行) / 单例 / 分组关系(ADR-0011) → 409。结构校验由 @Valid → 400 负责。 */
    private void validate(ReplaceRequest req) {
        Set<Long> pageIds = req.pages().stream().map(PageItem::id).collect(Collectors.toSet());
        Map<Long, Integer> cellsByPage = new HashMap<>();
        Map<IconType, Integer> singletonCount = new HashMap<>();
        Map<Long, IconItem> byId = new HashMap<>();
        Set<Long> groupsWithMember = new HashSet<>();
        int idx = 0;
        for (IconItem i : req.icons()) {
            if (byId.put(i.id(), i) != null)
                throw new OperationConflictException(409, "icons[" + idx + "] 的 id 重复:" + i.id());
            idx++;
        }
        idx = 0;
        for (IconItem i : req.icons()) {
            if (!pageIds.contains(i.pageId()))
                throw new OperationConflictException(409, "icons[" + idx + "] 引用了不存在的页面:" + i.pageId());
            if (i.parentId() != null) {
                IconItem parent = byId.get(i.parentId());
                if (parent == null)
                    throw new OperationConflictException(409, "icons[" + idx + "] 引用了不存在的分组:" + i.parentId());
                if (parent.type() != IconType.GROUP)
                    throw new OperationConflictException(409, "icons[" + idx + "] 的 parentId 指向的不是分组");
                if (parent.parentId() != null)
                    throw new OperationConflictException(409, "分组不能嵌套(组行自身带 parentId)");
                if (i.type() != IconType.NAV)
                    throw new OperationConflictException(409, "icons[" + idx + "] 只有网站链接可作为分组成员");
                if (!i.pageId().equals(parent.pageId()))
                    throw new OperationConflictException(409, "icons[" + idx + "] 分组成员必须与分组同页");
                groupsWithMember.add(i.parentId());
            } else {
                // 容量只计顶层行:组内成员不计(ADR-0011);每图标 1 格(ADR-0016)
                int used = cellsByPage.merge(i.pageId(), 1, Integer::sum);
                if (used > DataBootstrap.DEFAULT_CAPACITY_CELLS)
                    throw new OperationConflictException(409, "页面(blob 内 " + i.pageId()
                            + ")容量超过 " + DataBootstrap.DEFAULT_CAPACITY_CELLS + " 格");
            }
            if (i.type().isSingleton() && singletonCount.merge(i.type(), 1, Integer::sum) > 1)
                throw new OperationConflictException(409, "单例类型 " + i.type() + " 出现多次");
            idx++;
        }
        // 空组不存活:每个组行至少 1 个成员
        for (Map.Entry<Long, IconItem> e : byId.entrySet()) {
            if (e.getValue().type() == IconType.GROUP && !groupsWithMember.contains(e.getKey()))
                throw new OperationConflictException(409, "分组(blob 内 " + e.getKey() + ")没有成员,空组不被接受");
        }
    }

    /** 插入单个 icon 行(重定向 pageId 与 parentId 后)。 */
    private Icon insertIcon(Long userId, IconItem ii, Map<Long, Long> pageIdMap, Long newParentId) {
        Icon ic = new Icon();
        ic.setUserId(userId);
        ic.setPageId(pageIdMap.get(ii.pageId()));
        ic.setParentId(newParentId);
        ic.setType(ii.type());
        ic.setSortOrder(ii.sortOrder());
        ic.setData(ii.data());
        return iconRepository.save(ic);
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

    /** blob 内的 icon。id 为**客户端键**(同 {@link PageItem#id} 先例,服务端整体重分配);
     *  pageId 引用 {@link PageItem#id};parentId 引用某 GROUP 行的 id,顶层为 null。
     *  type 为大写枚举名(对齐 GET 输出)。旧备份(v2 前)多余的 size 字段由 Jackson 忽略。 */
    public record IconItem(
            @NotNull Long id,
            @NotNull Long pageId,
            Long parentId,
            @NotNull IconType type,
            @NotNull Integer sortOrder,
            Map<String, Object> data) {
    }
}
