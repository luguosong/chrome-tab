package com.personal.newtab.configaggregate;

import com.personal.newtab.icon.Icon;
import com.personal.newtab.icon.IconType;
import com.personal.newtab.icon.Size;

import java.util.Map;

/** Icon 出参；聚合接口 expand 阶段返回。data 为类型专属配置（nav={name,url}、stock={symbol,name}、changelog=null）。 */
public record IconResponse(
        Long id,
        Long pageId,
        IconType type,
        Size size,
        Integer sortOrder,
        Map<String, Object> data) {
    public static IconResponse of(Icon i) {
        return new IconResponse(i.getId(), i.getPageId(), i.getType(), i.getSize(), i.getSortOrder(), i.getData());
    }
}
