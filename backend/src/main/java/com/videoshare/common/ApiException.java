package com.videoshare.common;

public class ApiException extends RuntimeException {
    private final ErrorCode errorCode;
    public ApiException(ErrorCode errorCode, String message) { super(message); this.errorCode = errorCode; }
    public ErrorCode errorCode() { return errorCode; }
}
