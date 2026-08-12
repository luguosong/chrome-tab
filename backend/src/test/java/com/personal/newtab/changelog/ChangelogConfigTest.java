package com.personal.newtab.changelog;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * ChangelogConfig.extractContent 纯逻辑测试（TDD 接缝 4）。
 *
 * <p>OpenAI 兼容响应解析是本特性唯一触外的正确性要点，且无法经 Service/Controller 测试覆盖
 * （Service 桩掉 Translator、Controller 桩掉 Service），故单测此静态方法。畸形形态一律返回 null，
 * 上抛交给 Service 降级英文——不得抛 ClassCastException。</p>
 */
class ChangelogConfigTest {

    @Test
    void extractsContentFromOpenAiShape() {
        Map<String, Object> resp = Map.of("choices", List.of(
                Map.of("message", Map.of("content", "## 1.0\n- 你好"))));
        assertThat(ChangelogConfig.extractContent(resp)).isEqualTo("## 1.0\n- 你好");
    }

    @Test
    void returnsNullWhenChoicesMissingOrEmpty() {
        assertThat(ChangelogConfig.extractContent(null)).isNull();
        assertThat(ChangelogConfig.extractContent(Map.of())).isNull();
        assertThat(ChangelogConfig.extractContent(Map.of("choices", List.of()))).isNull();
    }

    @Test
    void returnsNullWhenMessageOrContentMissing() {
        assertThat(ChangelogConfig.extractContent(Map.of("choices", List.of(Map.of())))).isNull();
        assertThat(ChangelogConfig.extractContent(
                Map.of("choices", List.of(Map.of("message", Map.of()))))).isNull();
    }

    @Test
    void returnsNullOnMalformedChoicesElementOrNonStringContent() {
        // choices[0] 是字符串而非对象，content 是数字而非字符串 —— 不得抛 CCE，返回 null 触发降级
        assertThat(ChangelogConfig.extractContent(Map.of("choices", List.of("not a map")))).isNull();
        assertThat(ChangelogConfig.extractContent(Map.of("choices", List.of(
                Map.of("message", Map.of("content", 42)))))).isNull();
    }
}
