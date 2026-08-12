package com.personal.newtab.weather;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestClient;

/**
 * 装配天气特性(见 ADR-0009):和风 {@link RestClient}(个人专用主机)+ {@link WeatherService}。
 *
 * <p>RestClient 的 baseUrl 仅在已配置主机时取真值;未配置时给占位主机——因 {@link WeatherService}
 * 在每次入口先 {@code requireConfigured()} 拦截,占位主机不会被真请求。Key 以请求头
 * {@code X-QW-Api-Key} 逐请求注入(Service 层),不烘焙进 client,便于统一拦截空 Key。</p>
 */
@Configuration
@EnableConfigurationProperties(WeatherProperties.class)
public class WeatherConfig {

    @Bean
    RestClient weatherRestClient(WeatherProperties props) {
        return RestClient.builder()
                .baseUrl(baseUrlFor(props.getApiHost()))
                .requestInterceptor(new GzipDecompressingInterceptor())   // 和风无条件 gzip,见该类 javadoc
                .build();
    }

    /**
     * 由配置主机解析 RestClient baseUrl。未配置 → 占位主机(因 {@link WeatherService#requireConfigured()}
     * 先抛,不会真请求)。
     *
     * <p>历史 bug:application.yml 的 {@code api-host} 默认值曾是无 scheme 的裸主机(如
     * {@code p75n8gyjky.re.qweatherapi.com}),JDK HttpClient 在请求构建期抛 "URI with undefined scheme"。
     * 故此处对裸主机统一补 {@code https://}。</p>
     */
    static String baseUrlFor(String apiHost) {
        if (apiHost == null || apiHost.isBlank()) {
            return "https://devapi.qweatherapi.com";   // 占位:未配置时 requireConfigured() 先抛,不会真请求
        }
        String host = apiHost.trim();
        if (host.startsWith("http://") || host.startsWith("https://")) {
            return host;
        }
        return "https://" + host;
    }

    @Bean
    WeatherService weatherService(RestClient weatherRestClient, WeatherProperties props) {
        return new WeatherService(weatherRestClient, props);
    }
}
