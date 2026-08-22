package com.personal.newtab.changelog;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.http.client.ClientHttpRequestFactoryBuilder;
import org.springframework.boot.http.client.ClientHttpRequestFactorySettings;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.MediaType;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.web.client.RestClient;

import java.time.Duration;
import java.util.List;
import java.util.Map;

/**
 * 装配更新日志中文译制管线（见 ADR 0005 / ADR-0017）：GitHub 原文 fetcher + aihubmix 译制器 +
 * {@link ChangelogService}(译文/快照持久化) + {@link ChangelogScheduler}(6 小时定时预取)。
 *
 * <p>两个 {@link RestClient}（GitHub 原文、LLM 网关）在此声明——RestClientConfig 尚未纳入提交历史，
 * 故把本特性的外部客户端与 Service 收拢在 changelog 模块内，保证特性提交自洽、可独立构建启动。</p>
 */
@Configuration
@EnableScheduling
@EnableConfigurationProperties(ChangelogProperties.class)
public class ChangelogConfig {

    /** 译制系统提示：约束只产出 markdown、原样保留结构与内联标记、不译版本号/URL/命令名。 */
    private static final String SYSTEM_PROMPT = """
            你是专业技术译者。把用户给出的 CHANGELOG markdown 片段由英文译成简体中文。
            严格约束：
            1. 只输出译制后的 markdown 片段本身，不要任何解释、前后缀、也不要代码围栏 ```。
            2. 原样保留全部结构：## / ### 标题层级、- 列表符号、空行。
            3. 原样保留全部行内 markdown：`code`、**bold**、[text](url)。
            4. 不要翻译：版本号（如 1.2.3）、代码片段内容、URL、命令名、配置键名。
            5. 通用技术术语（Claude Code、API、token、hook 等）可保留原文或按惯例中译。""";

    /** 显式超时(ADR-0017):RestClient 默认无 read timeout,LLM/外网挂起会让定时预取线程永久卡死。
     *  LLM 译一大块可达分钟级,read 放宽到 5 分钟;GitHub/npm 常规外呼 60s/30s 足够。 */
    private static RestClient timed(String baseUrl, Duration connect, Duration read) {
        return RestClient.builder()
                .baseUrl(baseUrl)
                .requestFactory(ClientHttpRequestFactoryBuilder.detect().build(
                        ClientHttpRequestFactorySettings.defaults()
                                .withConnectTimeout(connect)
                                .withReadTimeout(read)))
                .build();
    }

    @Bean
    RestClient githubRawRestClient() {
        return timed("https://raw.githubusercontent.com", Duration.ofSeconds(10), Duration.ofSeconds(60));
    }

    /** npm registry packument(ADR-0016 发布日期源)。 */
    @Bean
    RestClient npmRegistryRestClient() {
        return timed("https://registry.npmjs.org", Duration.ofSeconds(10), Duration.ofSeconds(30));
    }

    @Bean
    RestClient llmRestClient(ChangelogProperties props) {
        return timed(props.getLlm().getBaseUrl(), Duration.ofSeconds(10), Duration.ofMinutes(5));
    }

    @Bean
    NpmReleaseDateService npmReleaseDateService(@Qualifier("npmRegistryRestClient") RestClient npm) {
        return new NpmReleaseDateService(npm);
    }

    @Bean
    ChangelogService changelogService(
            @Qualifier("githubRawRestClient") RestClient github,
            @Qualifier("llmRestClient") RestClient llm,
            ChangelogTranslationRepository translations,
            ChangelogSnapshotRepository snapshots,
            NpmReleaseDateService npmDates,
            ChangelogProperties props) {
        return new ChangelogService(
                () -> github.get()
                        .uri("/anthropics/claude-code/main/CHANGELOG.md")
                        .retrieve()
                        .body(String.class),
                translator(llm, props),
                translations,
                snapshots,
                npmDates,
                props.getTranslateRecent());
    }

    @Bean
    ChangelogScheduler changelogScheduler(ChangelogService service) {
        return new ChangelogScheduler(service);
    }

    private static ChangelogService.Translator translator(RestClient llm, ChangelogProperties props) {
        String apiKey = props.getLlm().getApiKey();
        String model = props.getLlm().getModel();
        return slice -> {
            if (apiKey == null || apiKey.isBlank()) {
                return null;   // Key 缺失：Service 层据此透传英文原文
            }
            Map<String, Object> body = Map.of(
                    "model", model,
                    "messages", List.of(
                            Map.of("role", "system", "content", SYSTEM_PROMPT),
                            Map.of("role", "user", "content", slice)));
            Map<String, Object> resp = llm.post()
                    .uri("/chat/completions")
                    .header("Authorization", "Bearer " + apiKey)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(body)
                    .retrieve()
                    .body(Map.class);
            return extractContent(resp);
        };
    }

    /** 从 OpenAI 兼容响应里取 choices[0].message.content；任何畸形形态返回 null（调用方据此降级英文）。 */
    static String extractContent(Map<String, Object> resp) {
        if (resp == null) return null;
        Object choices = resp.get("choices");
        if (!(choices instanceof List<?> list) || list.isEmpty()) return null;
        Object first = list.get(0);
        if (!(first instanceof Map<?, ?> firstMap)) return null;
        Object message = firstMap.get("message");
        if (!(message instanceof Map<?, ?> msg)) return null;
        Object content = msg.get("content");
        return (content instanceof String s) ? s : null;
    }
}
