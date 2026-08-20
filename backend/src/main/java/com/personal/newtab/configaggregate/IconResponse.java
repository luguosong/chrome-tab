package com.personal.newtab.configaggregate;

import com.personal.newtab.icon.Icon;
import com.personal.newtab.icon.IconType;

import java.util.Map;

/** Icon 出参；聚合接口 expand 阶段返回。data 为类型专属配置（nav={name,url}、stock={symbol,name}、changelog=null、
 *  group={name}）。parentId：分组成员的组行 id，顶层图标为 null（ADR-0011）。
 *  图标无尺寸档位、恒占 1 格（ADR-0016）。 */
public record IconResponse(
        Long id,
        Long pageId,
        Long parentId,
        IconType type,
        Integer sortOrder,
        Map<String, Object> data) {
    public static IconResponse of(Icon i) {
        return new IconResponse(i.getId(), i.getPageId(), i.getParentId(), i.getType(), i.getSortOrder(), i.getData());
    }
}
