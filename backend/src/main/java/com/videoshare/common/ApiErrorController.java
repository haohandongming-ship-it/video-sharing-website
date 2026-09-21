package com.videoshare.common;

import jakarta.servlet.RequestDispatcher;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.boot.webmvc.error.ErrorController;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 兜底错误端点：把 MVC 层之外的错误也纳入项目统一响应契约。
 *
 * <p>{@link GlobalExceptionHandler} 只能覆盖进入 DispatcherServlet 之后的异常。过滤器链
 * 中抛出的异常（例如表单解析失败、异步派发失败）会绕过它，最终落到 Spring Boot 默认的
 * {@code /error}，输出 {@code {"timestamp","status","error","path"}} 这样的默认结构 ——
 * 客户端无法用统一信封解析，且错误体会回显完整请求路径。</p>
 *
 * <p>实现 {@link ErrorController} 会让 Spring Boot 的 {@code BasicErrorController} 自动退避
 * （其自动配置带 {@code @ConditionalOnMissingBean(ErrorController.class)}），因此这里就是
 * 唯一的 {@code /error} 处理器。</p>
 */
@RestController
public class ApiErrorController implements ErrorController {

    @RequestMapping("/error")
    public ResponseEntity<ApiResponse<Void>> error(HttpServletRequest request) {
        int status = statusOf(request);
        ErrorCode code = codeOf(status);
        return ResponseEntity.status(status).body(ApiResponse.error(code, messageOf(code)));
    }

    /** 取容器记录的错误状态码；拿不到时按 500 处理。 */
    private static int statusOf(HttpServletRequest request) {
        Object attribute = request.getAttribute(RequestDispatcher.ERROR_STATUS_CODE);
        return attribute instanceof Integer code ? code : 500;
    }

    /** 按 HTTP 状态映射到业务错误码；未覆盖的状态统一归为 INTERNAL。 */
    private static ErrorCode codeOf(int status) {
        return switch (status) {
            case 400 -> ErrorCode.VALIDATION;
            case 401 -> ErrorCode.UNAUTHORIZED;
            case 403 -> ErrorCode.FORBIDDEN;
            case 404 -> ErrorCode.NOT_FOUND;
            case 409 -> ErrorCode.CONFLICT;
            case 429 -> ErrorCode.RATE_LIMITED;
            default -> ErrorCode.INTERNAL;
        };
    }

    /** 与 {@link GlobalExceptionHandler} 保持一致的对外文案。 */
    private static String messageOf(ErrorCode code) {
        return switch (code) {
            case VALIDATION -> "参数校验失败";
            case UNAUTHORIZED, TOKEN_INVALID -> "请先登录";
            case FORBIDDEN -> "没有权限执行此操作";
            case NOT_FOUND -> "资源不存在";
            case CONFLICT -> "操作冲突，请稍后重试";
            case RATE_LIMITED -> "请求过于频繁，请稍后重试";
            default -> "服务暂时不可用";
        };
    }
}
