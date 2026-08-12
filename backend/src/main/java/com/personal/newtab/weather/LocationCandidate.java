package com.personal.newtab.weather;

/**
 * 城市搜索(GeoAPI /geo/v2/city/lookup)的一条候选,用于新增抽屉城市选择器消歧(见 ADR-0009)。
 * lat/lon 是后续三套天气取数的统一坐标(经纬度入参,不再保留 Location ID)。
 */
public record LocationCandidate(String name, String adm1, String adm2, double lat, double lon) {}
