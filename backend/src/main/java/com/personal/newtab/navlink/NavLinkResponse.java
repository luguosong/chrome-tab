package com.personal.newtab.navlink;

/** 导航链接出参；同时被 NavLinkController 与 ConfigController 聚合复用。 */
public record NavLinkResponse(Long id, String name, String url, Integer sortOrder) {
    public static NavLinkResponse of(NavLink n) {
        return new NavLinkResponse(n.getId(), n.getName(), n.getUrl(), n.getSortOrder());
    }
}
