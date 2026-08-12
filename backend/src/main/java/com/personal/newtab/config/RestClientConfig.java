package com.personal.newtab.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestClient;

/**
 * 外部 HTTP 客户端 Bean。spring-boot-starter-web 自带 RestClient，无需额外依赖。
 */
@Configuration
public class RestClientConfig {

    /** 必应壁纸代理专用客户端 */
    @Bean
    public RestClient bingRestClient() {
        return RestClient.builder()
                .baseUrl("https://www.bing.com")
                .build();
    }
}
