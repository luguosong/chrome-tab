package com.personal.newtab.icon;

/**
 * 多态 Icon 表的 type 区分列（见 ADR-0001）。
 * nav  = 网站链接（基础类型，data={name,url}）
 * stock = 自选股（扩展类型，data={symbol,name}）
 * changelog = 更新日志流（扩展类型，单例，data=null）
 */
public enum IconType {
    NAV,
    STOCK,
    CHANGELOG
}
