package com.personal.newtab.weather;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpRequest;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.client.ClientHttpResponse;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.zip.GZIPOutputStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

/**
 * {@link GzipDecompressingInterceptor} 解压逻辑测试。
 *
 * <p>和风对一切响应无条件 gzip;若不解压,4xx 异常 body 是乱码、200 的 Jackson 解析必败。
 * 本测试锁死两件事:① gzip 响应被还原为原文且 Content-Encoding/Length 被摘除;② 非 gzip 响应原样透传。</p>
 */
class GzipDecompressingInterceptorTest {

    @Test
    void decompressesGzipResponseAndStripsEncodingHeader() throws Exception {
        String original = "{\"now\":{\"temp\":23}}";
        byte[] gzipped = gzip(original);
        FakeResponse upstream = new FakeResponse(gzipped, "gzip");

        // 拦截器不读 request,用 mock 即可;execution 是函数式接口,直接 lambda 返回 upstream
        ClientHttpResponse out = new GzipDecompressingInterceptor()
                .intercept(mock(HttpRequest.class), new byte[0], (req, body) -> upstream);

        String body = new String(out.getBody().readAllBytes(), StandardCharsets.UTF_8);
        assertThat(body).isEqualTo(original);                              // 已解压回原文
        assertThat(out.getHeaders().getFirst("Content-Encoding")).isNull(); // 摘掉,避免下游二次解压
        assertThat(out.getHeaders().getFirst("Content-Length")).isNull();
        assertThat(out.getStatusCode().value()).isEqualTo(200);
    }

    @Test
    void passesThroughNonGzipResponseUnchanged() throws Exception {
        byte[] plain = "plain".getBytes(StandardCharsets.UTF_8);
        FakeResponse upstream = new FakeResponse(plain, null);

        ClientHttpResponse out = new GzipDecompressingInterceptor()
                .intercept(mock(HttpRequest.class), new byte[0], (req, body) -> upstream);

        // 非 gzip:拦截器不应包 GZIPInputStream(否则会把明文当 gzip 解析报错),原样返回同一实例
        assertThat(out).isSameAs(upstream);
    }

    private static byte[] gzip(String s) throws Exception {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        try (GZIPOutputStream gz = new GZIPOutputStream(bos)) {
            gz.write(s.getBytes(StandardCharsets.UTF_8));
        }
        return bos.toByteArray();
    }

    /** 最小可用的 ClientHttpResponse 桩:body 一次性字节数组,头可放一个 Content-Encoding。 */
    private static final class FakeResponse implements ClientHttpResponse {
        private final byte[] body;
        private final String encoding;

        FakeResponse(byte[] body, String encoding) {
            this.body = body;
            this.encoding = encoding;
        }

        @Override public HttpStatusCode getStatusCode() { return HttpStatusCode.valueOf(200); }
        @Override public String getStatusText() { return "OK"; }
        @Override public void close() { }
        @Override public InputStream getBody() { return new ByteArrayInputStream(body); }
        @Override public HttpHeaders getHeaders() {
            HttpHeaders h = new HttpHeaders();
            if (encoding != null) h.add("Content-Encoding", encoding);
            return h;
        }
    }
}
