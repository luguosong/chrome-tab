package com.personal.newtab.weather;

import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpRequest;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.client.ClientHttpRequestExecution;
import org.springframework.http.client.ClientHttpRequestInterceptor;
import org.springframework.http.client.ClientHttpResponse;

import java.io.IOException;
import java.io.InputStream;
import java.util.zip.GZIPInputStream;

/**
 * 和风天气对所有响应<b>无条件 gzip</b>(实测:即便请求不带 {@code Accept-Encoding},或显式发
 * {@code Accept-Encoding: identity},响应仍是 {@code Content-Encoding: gzip})。而 RestClient
 * 基于 {@code java.net.http.HttpClient},JDK HttpClient <b>不自动解压</b>。不处理则两类故障:
 * <ul>
 *   <li>4xx 时 {@code HttpClientErrorException.getResponseBodyAsString()} 是 gzip 乱码,
 *       排障读不到 QWeather 的 {@code error.detail}(本类正是为此排查而加);</li>
 *   <li>即便拿到 200,{@code .body(Map.class)} 的 Jackson 在 gzip 字节上解析必败。</li>
 * </ul>
 *
 * <p>本拦截器在响应含 {@code Content-Encoding: gzip} 时把 body 包成 {@link GZIPInputStream},
 * 并摘掉 {@code Content-Encoding}/{@code Content-Length}(已解压,原值不再准确),下游无感。</p>
 */
final class GzipDecompressingInterceptor implements ClientHttpRequestInterceptor {

    @Override
    public ClientHttpResponse intercept(HttpRequest request, byte[] body,
                                        ClientHttpRequestExecution execution) throws IOException {
        ClientHttpResponse resp = execution.execute(request, body);
        String enc = resp.getHeaders().getFirst(HttpHeaders.CONTENT_ENCODING);
        if (enc != null && enc.toLowerCase().contains("gzip")) {
            return new DecompressedResponse(resp);
        }
        return resp;
    }

    private static final class DecompressedResponse implements ClientHttpResponse {
        private final ClientHttpResponse delegate;

        DecompressedResponse(ClientHttpResponse delegate) {
            this.delegate = delegate;
        }

        @Override
        public InputStream getBody() throws IOException {
            return new GZIPInputStream(delegate.getBody());
        }

        @Override
        public HttpHeaders getHeaders() {
            // 已解压:Content-Encoding 必须摘掉(否则下游 HttpComponents 等后端会二次解压);
            // Content-Length 指的是压缩前长度,解压后不再准确,一并删除。
            HttpHeaders h = new HttpHeaders();
            h.putAll(delegate.getHeaders());
            h.remove(HttpHeaders.CONTENT_ENCODING);
            h.remove(HttpHeaders.CONTENT_LENGTH);
            return h;
        }

        @Override
        public HttpStatusCode getStatusCode() throws IOException {
            return delegate.getStatusCode();
        }

        @Override
        public String getStatusText() throws IOException {
            return delegate.getStatusText();
        }

        @Override
        public void close() {
            delegate.close();
        }
    }
}
