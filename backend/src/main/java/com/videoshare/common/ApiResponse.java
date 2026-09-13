package com.videoshare.common;

import com.fasterxml.jackson.annotation.JsonInclude;

@JsonInclude(JsonInclude.Include.ALWAYS)
public record ApiResponse<T>(int code, String message, T data, long timestamp) {
    public static <T> ApiResponse<T> ok(T data) { return new ApiResponse<>(0, "success", data, System.currentTimeMillis()); }
    public static ApiResponse<Void> error(ErrorCode code, String message) { return new ApiResponse<>(code.code(), message, null, System.currentTimeMillis()); }
}
