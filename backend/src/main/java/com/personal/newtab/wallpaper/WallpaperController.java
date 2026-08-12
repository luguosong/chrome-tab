package com.personal.newtab.wallpaper;

import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestClient;

/**
 * 代理必应每日壁纸，规避浏览器 CORS。
 * 必应接口：HPImageArchive.aspx?format=js&idx=0&n=1&mkt=zh-CN，返回 images[0]。
 * 全 urlbase + _1920x1080.jpg 得到高清横图。
 *
 * 按天内存缓存：壁纸一天一换，命中即返回，避免每次请求都打必应。
 */
@RestController
@RequestMapping("/api/wallpaper")
public class WallpaperController {

    private static final String BING_HOST = "https://www.bing.com";

    private final RestClient bingRestClient;

    // 手写构造函数：@Qualifier 需落在构造参数上，Lombok @RequiredArgsConstructor 不会复制它
    public WallpaperController(@Qualifier("bingRestClient") RestClient bingRestClient) {
        this.bingRestClient = bingRestClient;
    }

    // 极简按天缓存：enddate 变化才重新拉取
    private volatile WallpaperResponse cached;

    @GetMapping
    @SuppressWarnings("unchecked")
    public WallpaperResponse get() {
        WallpaperResponse snap = cached;
        if (snap != null) {
            return snap;
        }
        Map<String, Object> resp = bingRestClient.get()
                .uri(uri -> uri.scheme("https")
                        .host("www.bing.com")
                        .path("/HPImageArchive.aspx")
                        .queryParam("format", "js")
                        .queryParam("idx", 0)
                        .queryParam("n", 1)
                        .queryParam("mkt", "zh-CN")
                        .build())
                .retrieve()
                .body(Map.class);
        List<Map<String, Object>> images = resp == null ? null : (List<Map<String, Object>>) resp.get("images");
        if (images == null || images.isEmpty()) {
            throw new IllegalStateException("必应壁纸响应不含 images");
        }
        Map<String, Object> img = images.get(0);
        String urlbase = (String) img.get("urlbase");
        String url = BING_HOST + urlbase + "_1920x1080.jpg";
        String copyright = (String) img.getOrDefault("copyright", "");
        String date = (String) img.getOrDefault("enddate", "");
        WallpaperResponse result = new WallpaperResponse(url, copyright, date);
        cached = result;
        return result;
    }
}
