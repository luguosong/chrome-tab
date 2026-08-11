package com.personal.newtab.configaggregate;

import com.personal.newtab.page.Page;

/** Page 出参；聚合接口 expand 阶段返回。 */
public record PageResponse(Long id, String name, Integer sortOrder) {
    public static PageResponse of(Page p) {
        return new PageResponse(p.getId(), p.getName(), p.getSortOrder());
    }
}
