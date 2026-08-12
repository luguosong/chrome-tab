package com.personal.newtab.changelog;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 更新日志译制配置（newtab.changelog.*，见 ADR 0005）。
 *
 * <p>默认值即生产期望：最近 5 版、aihubmix 网关、gpt-5-nano。可用 application.yml 或环境变量覆盖。
 * Key 走 {@code AIHUBMIX_API_KEY} 环境变量注入，留空则跳过译制、透传英文原文。</p>
 */
@Getter
@Setter
@ConfigurationProperties("newtab.changelog")
public class ChangelogProperties {

    /** 译制最近多少个版本（164K token 约束下的强制截断，见 ADR 0005）。 */
    private int translateRecent = 5;

    private Llm llm = new Llm();

    @Getter
    @Setter
    public static class Llm {
        /** OpenAI 兼容网关基址。 */
        private String baseUrl = "https://aihubmix.com/v1";
        /** 模型名。GPT-5 系为推理模型，temperature 被网关忽略，确定性靠系统提示约束。 */
        private String model = "gpt-5-nano";
        /** API Key；留空则跳过译制。不入库，部署期经 AIHUBMIX_API_KEY 注入。 */
        private String apiKey = "";
    }
}
