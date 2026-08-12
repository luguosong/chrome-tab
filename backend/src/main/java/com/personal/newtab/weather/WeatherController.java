package com.personal.newtab.weather;

import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 天气代理(见 ADR-0009)。走 /api/** 统一鉴权(同源 cookie)。两个端点:
 * <ul>
 *   <li>{@code GET /api/weather?location=lat,lon&location=lat,lon} → 批量三合一 bundle,键为前端发送的原始串
 *       (发送与回查用同一串,确保命中)。单位置实况失败该键值为 null。</li>
 *   <li>{@code GET /api/weather/locations?q=城市名} → GeoAPI 城市候选,供新增抽屉选择器消歧。</li>
 * </ul>
 */
@RestController
@RequestMapping("/api/weather")
@RequiredArgsConstructor
public class WeatherController {

    private final WeatherService weatherService;

    @GetMapping
    public Map<String, WeatherBundle> get(HttpServletRequest request) {
        Map<String, WeatherBundle> out = new LinkedHashMap<>();
        // 不能用 @RequestParam List<String> location:Spring 的 StringToCollectionConverter 会把
        // 单个 "lat,lon" 按逗号拆成 ["lat","lon"] 两个值,parseLatLon 全失败 → 空响应(历史 bug:「天气刷新失败」)。
        // getParameterValues 只按 & 与重复参数切,逗号原样保留。
        String[] locations = request.getParameterValues("location");
        if (locations == null) return out;
        for (String raw : locations) {
            double[] ll = parseLatLon(raw);
            if (ll == null) continue;   // 非法格式跳过(前端控格式,不应出现)
            out.put(raw, weatherService.bundleFor(ll[0], ll[1]));
        }
        return out;
    }

    @GetMapping("/locations")
    public List<LocationCandidate> locations(@RequestParam("q") String q) {
        return weatherService.searchCities(q);
    }

    /** "lat,lon" → {lat, lon};非法格式返回 null。 */
    private static double[] parseLatLon(String raw) {
        if (raw == null) return null;
        String[] parts = raw.split(",");
        if (parts.length != 2) return null;
        try {
            return new double[]{Double.parseDouble(parts[0].trim()), Double.parseDouble(parts[1].trim())};
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
