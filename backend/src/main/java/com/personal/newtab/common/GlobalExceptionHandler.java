package com.personal.newtab.common;

import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

    /** Icon/Page 写操作的容量/单例/越权/非空页等业务约束冲突 → 按异常携带的 status 返回。 */
    @ExceptionHandler(OperationConflictException.class)
    public ResponseEntity<ErrorResponse> operationConflict(OperationConflictException e) {
        return ResponseEntity.status(e.getStatus()).body(new ErrorResponse(e.getStatus(), e.getMessage()));
    }

    @ExceptionHandler(BadCredentialsException.class)
    public ResponseEntity<ErrorResponse> badCredentials(BadCredentialsException e) {
        return ResponseEntity.status(401).body(new ErrorResponse(401, "用户名或密码错误"));
    }

    @ExceptionHandler(AuthenticationException.class)
    public ResponseEntity<ErrorResponse> auth(AuthenticationException e) {
        return ResponseEntity.status(401).body(new ErrorResponse(401, "未认证"));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorResponse> validation(MethodArgumentNotValidException e) {
        String msg = e.getBindingResult().getFieldErrors().stream()
                .map(f -> f.getField() + ": " + f.getDefaultMessage())
                .reduce((a, b) -> a + "; " + b)
                .orElse("参数校验失败");
        return ResponseEntity.status(400).body(new ErrorResponse(400, msg));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> fallback(Exception e) {
        log.error("未捕获异常", e);  // 不静默吞：500 必须留栈便于定位
        return ResponseEntity.status(500).body(new ErrorResponse(500, "服务器错误"));
    }

    /** 唯一约束等冲突（如重复 symbol）→ 409，不泄露 DB 细节 */
    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<ErrorResponse> conflict(DataIntegrityViolationException e) {
        log.warn("数据冲突: {}", e.getMostSpecificCause().getMessage());
        return ResponseEntity.status(409).body(new ErrorResponse(409, "数据冲突，可能已存在"));
    }
}
