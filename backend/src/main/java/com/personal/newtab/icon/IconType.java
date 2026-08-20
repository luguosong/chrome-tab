package com.personal.newtab.icon;

/**
 * 多态 Icon 表的 type 区分列（见 ADR-0001）。
 * nav  = 网站链接（基础类型，data={name,url}）
 * stock = 自选股（扩展类型，data={symbol,name}）
 * changelog = 更新日志流（扩展类型，单例，data=null）
 * weather = 天气（扩展类型，非单例，data={location:{name,adm1,adm2,lat,lon}}，见 ADR-0009）
 * group = 分组（ADR-0011：固定 SMALL 占 1 格，data={name}，成员经 icons.parent_id 指向组行；
 *   只能经 merge 端点创建，空组不存活）
 */
public enum IconType {
    NAV,
    STOCK,
    CHANGELOG,
    WEATHER,
    GROUP;

    /** 单例类型（CONTEXT.md）：该 user 全局仅允许一个实例。后端单一事实源，POST /api/icons 校验用。 */
    public boolean isSingleton() {
        return this == CHANGELOG;
    }
}
