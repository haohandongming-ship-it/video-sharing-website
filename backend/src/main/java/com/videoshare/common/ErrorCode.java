package com.videoshare.common;

public enum ErrorCode {
    VALIDATION(40001), UNAUTHORIZED(40101), TOKEN_INVALID(40102), FORBIDDEN(40301), NOT_FOUND(40401), CONFLICT(40009), RATE_LIMITED(42901), INTERNAL(50001);
    private final int code;
    ErrorCode(int code) { this.code = code; }
    public int code() { return code; }
}
