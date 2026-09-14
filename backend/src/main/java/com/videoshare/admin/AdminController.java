package com.videoshare.admin;

import com.videoshare.auth.CurrentUser;
import com.videoshare.common.ApiException;
import com.videoshare.common.ApiResponse;
import com.videoshare.common.ErrorCode;
import com.videoshare.common.IdempotencyService;
import com.videoshare.common.PageResult;
import com.videoshare.user.Role;
import com.videoshare.user.UserStatus;
import java.util.Map;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/admin")
public class AdminController {

    private final AdminService service;
    private final IdempotencyService idempotency;

    public AdminController(AdminService service, IdempotencyService idempotency) {
        this.service = service;
        this.idempotency = idempotency;
    }

    @GetMapping("/overview")
    public ApiResponse<Map<String, Object>> overview(@AuthenticationPrincipal CurrentUser c) {
        admin(c);
        return ApiResponse.ok(service.overview());
    }

    @GetMapping("/reviews")
    public ApiResponse<PageResult<Map<String, Object>>> reviews(@AuthenticationPrincipal CurrentUser c,
                                                                @RequestParam(required = false) String status,
                                                                @RequestParam(required = false) String riskLevel,
                                                                @RequestParam(defaultValue = "1") int page,
                                                                @RequestParam(defaultValue = "10") int pageSize) {
        moderator(c);
        return ApiResponse.ok(service.reviews(status, riskLevel, page, pageSize));
    }

    @PostMapping("/reviews/{id}/decision")
    public ApiResponse<Map<String, Object>> decide(@PathVariable long id,
                                                   @AuthenticationPrincipal CurrentUser c,
                                                   @RequestHeader(name = "Idempotency-Key", required = false) String key,
                                                   @RequestBody Map<String, String> body) {
        moderator(c);
        return ApiResponse.ok(idempotency.execute(c.id(), "admin:review:" + id, key,
                () -> service.decide(c.id(), id, body.get("decision"), body.get("note"))));
    }

    @GetMapping("/reports")
    public ApiResponse<PageResult<Map<String, Object>>> reports(@AuthenticationPrincipal CurrentUser c,
                                                                @RequestParam(required = false) String status,
                                                                @RequestParam(required = false) String reason,
                                                                @RequestParam(defaultValue = "1") int page,
                                                                @RequestParam(defaultValue = "10") int pageSize) {
        moderator(c);
        return ApiResponse.ok(service.reports(status, reason, page, pageSize));
    }

    @PostMapping("/reports/{id}/handle")
    public ApiResponse<Map<String, Object>> handle(@PathVariable long id,
                                                   @AuthenticationPrincipal CurrentUser c,
                                                   @RequestHeader(name = "Idempotency-Key", required = false) String key,
                                                   @RequestBody Map<String, String> body) {
        moderator(c);
        return ApiResponse.ok(idempotency.execute(c.id(), "admin:report:" + id, key,
                () -> service.handleReport(c.id(), id, body.getOrDefault("status", "RESOLVED"), body.get("note"))));
    }

    @GetMapping("/users")
    public ApiResponse<PageResult<Map<String, Object>>> users(@AuthenticationPrincipal CurrentUser c,
                                                              @RequestParam(required = false) String keyword,
                                                              @RequestParam(required = false) String role,
                                                              @RequestParam(required = false) String status,
                                                              @RequestParam(defaultValue = "1") int page,
                                                              @RequestParam(defaultValue = "10") int pageSize) {
        admin(c);
        return ApiResponse.ok(service.users(keyword, role, status, page, pageSize));
    }

    @PutMapping("/users/{id}/status")
    public ApiResponse<Map<String, Object>> status(@PathVariable long id,
                                                   @AuthenticationPrincipal CurrentUser c,
                                                   @RequestBody Map<String, String> body) {
        admin(c);
        return ApiResponse.ok(service.status(c.id(), id, parseEnum(UserStatus.class, body.get("status"), "用户状态"), body.get("reason")));
    }

    @PutMapping("/users/{id}/role")
    public ApiResponse<Map<String, Object>> role(@PathVariable long id,
                                                 @AuthenticationPrincipal CurrentUser c,
                                                 @RequestBody Map<String, String> body) {
        admin(c);
        return ApiResponse.ok(service.role(c.id(), id, parseEnum(Role.class, body.get("role"), "用户角色")));
    }

    @GetMapping("/videos")
    public ApiResponse<PageResult<Map<String, Object>>> videos(@AuthenticationPrincipal CurrentUser c,
                                                               @RequestParam(required = false) String status,
                                                               @RequestParam(defaultValue = "1") int page,
                                                               @RequestParam(defaultValue = "10") int pageSize) {
        moderator(c);
        return ApiResponse.ok(service.videos(status, page, pageSize));
    }

    @GetMapping("/audit-logs")
    public ApiResponse<PageResult<Map<String, Object>>> logs(@AuthenticationPrincipal CurrentUser c,
                                                             @RequestParam(defaultValue = "1") int page,
                                                             @RequestParam(defaultValue = "15") int pageSize) {
        admin(c);
        return ApiResponse.ok(service.auditLogs(page, pageSize));
    }

    @GetMapping("/settings")
    public ApiResponse<Map<String, Object>> settings(@AuthenticationPrincipal CurrentUser c) {
        admin(c);
        return ApiResponse.ok(service.settings());
    }

    @PutMapping("/settings")
    public ApiResponse<Map<String, Object>> settings(@AuthenticationPrincipal CurrentUser c, @RequestBody Map<String, Object> body) {
        admin(c);
        return ApiResponse.ok(service.settings(c.id(), body));
    }

    /** 非法枚举值返回 400 校验错误，而不是让 IllegalArgumentException 落到 500。 */
    private static <E extends Enum<E>> E parseEnum(Class<E> type, String value, String label) {
        if (value == null || value.isBlank()) throw new ApiException(ErrorCode.VALIDATION, label + "不能为空");
        try {
            return Enum.valueOf(type, value);
        } catch (IllegalArgumentException ex) {
            throw new ApiException(ErrorCode.VALIDATION, "不支持的" + label);
        }
    }

    private void moderator(CurrentUser c) {
        if (c == null || (c.role() != Role.MODERATOR && c.role() != Role.ADMIN)) {
            throw new ApiException(ErrorCode.FORBIDDEN, "需要审核权限");
        }
    }

    private void admin(CurrentUser c) {
        if (c == null || c.role() != Role.ADMIN) throw new ApiException(ErrorCode.FORBIDDEN, "需要管理员权限");
    }
}
