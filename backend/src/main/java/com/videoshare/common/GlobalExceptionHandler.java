package com.videoshare.common;

import jakarta.validation.ConstraintViolationException;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.context.request.async.AsyncRequestNotUsableException;
import java.io.IOException;

@RestControllerAdvice
public class GlobalExceptionHandler {
    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);
    @ExceptionHandler(ApiException.class)
    ResponseEntity<ApiResponse<Void>> api(ApiException ex) { return ResponseEntity.status(status(ex.errorCode())).body(ApiResponse.error(ex.errorCode(), ex.getMessage())); }
    @ExceptionHandler({MethodArgumentNotValidException.class, ConstraintViolationException.class,
            org.springframework.http.converter.HttpMessageNotReadableException.class,
            org.springframework.web.method.annotation.MethodArgumentTypeMismatchException.class,
            org.springframework.web.bind.MissingServletRequestParameterException.class})
    ResponseEntity<ApiResponse<Void>> validation(Exception ex) { return ResponseEntity.badRequest().body(ApiResponse.error(ErrorCode.VALIDATION, "参数校验失败")); }
    @ExceptionHandler(AccessDeniedException.class)
    ResponseEntity<ApiResponse<Void>> denied() { return ResponseEntity.status(403).body(ApiResponse.error(ErrorCode.FORBIDDEN, "没有权限执行此操作")); }
    @ExceptionHandler({AsyncRequestNotUsableException.class, IOException.class})
    void clientDisconnected(Exception ex) { log.debug("客户端已断开长连接: {}", ex.getMessage()); }
    @ExceptionHandler(Exception.class)
    ResponseEntity<ApiResponse<Void>> unknown(Exception ex) { log.error("Unhandled API exception", ex); return ResponseEntity.internalServerError().body(ApiResponse.error(ErrorCode.INTERNAL, "服务暂时不可用")); }
    private int status(ErrorCode code) { return switch (code) { case UNAUTHORIZED, TOKEN_INVALID, BAD_CREDENTIALS, SMS_INVALID -> 401; case FORBIDDEN -> 403; case NOT_FOUND -> 404; case CONFLICT -> 409; case RATE_LIMITED -> 429; case INTERNAL -> 500; default -> 400; }; }
}
