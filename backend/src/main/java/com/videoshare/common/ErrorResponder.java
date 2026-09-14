package com.videoshare.common;

import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

/**
 * 过滤器链中写出错误信封。
 *
 * <p>此前 SecurityConfig 与 RequestedWithFilter 各自手写 JSON 字符串，既容易与
 * {@link ApiResponse} 的结构漂移，也无法转义消息内容。现在统一走同一个 ObjectMapper。</p>
 */
@Component
public class ErrorResponder {

    private final ObjectMapper json;

    public ErrorResponder(ObjectMapper json) {
        this.json = json;
    }

    public void write(HttpServletResponse response, int status, ErrorCode code, String message) throws IOException {
        response.setStatus(status);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.getWriter().write(json.writeValueAsString(ApiResponse.error(code, message)));
    }
}
