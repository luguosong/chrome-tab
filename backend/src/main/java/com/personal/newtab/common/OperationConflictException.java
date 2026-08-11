package com.personal.newtab.common;

/**
 * Icon/Page 写操作的业务约束冲突（容量超限、单例重复、越权/不存在、非空页删除）。
 * 由 {@link GlobalExceptionHandler} 转为 {@code status}（通常 409 或 404）+ message 响应。
 *
 * <p>领域中立——同时被 Icon 与 Page 写操作使用，故置于 common。
 * 用自定义异常而非 {@code ResponseStatusException}——后者会被全局 {@code @ExceptionHandler(Exception.class)}
 * fallback 吞成 500，需要单独 handler 才能保留状态码；统一走本类更直接。</p>
 */
public class OperationConflictException extends RuntimeException {

    private final int status;

    public OperationConflictException(int status, String message) {
        super(message);
        this.status = status;
    }

    public int getStatus() {
        return status;
    }
}
