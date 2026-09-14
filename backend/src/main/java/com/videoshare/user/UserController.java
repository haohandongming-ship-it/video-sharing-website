package com.videoshare.user;

import com.videoshare.auth.CurrentUser;
import com.videoshare.common.ApiException;
import com.videoshare.common.ApiResponse;
import com.videoshare.common.ErrorCode;
import com.videoshare.common.IdempotencyService;
import com.videoshare.common.PageResult;
import java.util.List;
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
@RequestMapping("/api/v1")
public class UserController {

    private final UserApiService service;
    private final IdempotencyService idempotency;

    public UserController(UserApiService service, IdempotencyService idempotency) {
        this.service = service;
        this.idempotency = idempotency;
    }

    @GetMapping("/categories")
    public ApiResponse<List<Map<String, Object>>> categories() {
        return ApiResponse.ok(service.categories());
    }

    @GetMapping("/users/me")
    public ApiResponse<Map<String, Object>> me(@AuthenticationPrincipal CurrentUser c) {
        return ApiResponse.ok(service.profile(require(c), c));
    }

    @PutMapping("/users/me")
    public ApiResponse<Map<String, Object>> update(@AuthenticationPrincipal CurrentUser c, @RequestBody Map<String, Object> body) {
        return ApiResponse.ok(service.update(require(c), body));
    }

    @PutMapping("/users/me/password")
    public ApiResponse<Map<String, Boolean>> password(@AuthenticationPrincipal CurrentUser c, @RequestBody Map<String, String> body) {
        service.password(require(c), body.get("oldPassword"), body.get("newPassword"));
        return ApiResponse.ok(Map.of("success", true));
    }

    @PostMapping("/users/me/real-name")
    public ApiResponse<Map<String, Object>> realName(@AuthenticationPrincipal CurrentUser c,
                                                     @RequestHeader(name = "Idempotency-Key", required = false) String key,
                                                     @RequestBody Map<String, String> body) {
        long user = require(c);
        return ApiResponse.ok(idempotency.execute(user, "user:real-name", key,
                () -> Map.of("status", service.realName(user, body.get("realName"), body.get("idCard")))));
    }

    @PostMapping("/users/me/deactivate")
    public ApiResponse<Map<String, Object>> deactivate(@AuthenticationPrincipal CurrentUser c,
                                                       @RequestHeader(name = "Idempotency-Key", required = false) String key,
                                                       @RequestBody(required = false) Map<String, String> body) {
        long user = require(c);
        return ApiResponse.ok(idempotency.execute(user, "user:deactivate", key,
                () -> service.deactivate(user, body == null ? null : body.get("reason"))));
    }

    @GetMapping("/users/suggested")
    public ApiResponse<List<Map<String, Object>>> suggested(@AuthenticationPrincipal CurrentUser c) {
        return ApiResponse.ok(service.suggested(c == null ? null : c.id()));
    }

    @GetMapping("/users/{id}")
    public ApiResponse<Map<String, Object>> profile(@PathVariable long id, @AuthenticationPrincipal CurrentUser c) {
        return ApiResponse.ok(service.profile(id, c));
    }

    @GetMapping("/users/{id}/videos")
    public ApiResponse<PageResult<Map<String, Object>>> videos(@PathVariable long id,
                                                               @RequestParam(defaultValue = "1") int page,
                                                               @RequestParam(defaultValue = "12") int pageSize,
                                                               @AuthenticationPrincipal CurrentUser c) {
        return ApiResponse.ok(service.videos(id, page, pageSize, c == null ? null : c.id()));
    }

    @GetMapping("/users/{id}/favorites")
    public ApiResponse<PageResult<Map<String, Object>>> favorites(@PathVariable long id,
                                                                  @RequestParam(defaultValue = "1") int page,
                                                                  @RequestParam(defaultValue = "12") int pageSize,
                                                                  @AuthenticationPrincipal CurrentUser c) {
        return ApiResponse.ok(service.favorites(id, page, pageSize, c == null ? null : c.id()));
    }

    @GetMapping("/users/{id}/followers")
    public ApiResponse<PageResult<Map<String, Object>>> followers(@PathVariable long id,
                                                                  @RequestParam(defaultValue = "1") int page,
                                                                  @RequestParam(defaultValue = "20") int pageSize,
                                                                  @AuthenticationPrincipal CurrentUser c) {
        return ApiResponse.ok(service.follows(id, true, page, pageSize, c == null ? null : c.id()));
    }

    @GetMapping("/users/{id}/following")
    public ApiResponse<PageResult<Map<String, Object>>> following(@PathVariable long id,
                                                                  @RequestParam(defaultValue = "1") int page,
                                                                  @RequestParam(defaultValue = "20") int pageSize,
                                                                  @AuthenticationPrincipal CurrentUser c) {
        return ApiResponse.ok(service.follows(id, false, page, pageSize, c == null ? null : c.id()));
    }

    @PostMapping("/users/{id}/follow")
    public ApiResponse<Map<String, Object>> follow(@PathVariable long id,
                                                   @AuthenticationPrincipal CurrentUser c,
                                                   @RequestBody Map<String, String> body) {
        return ApiResponse.ok(service.follow(require(c), id, !"UNFOLLOW".equals(body.get("action"))));
    }

    @GetMapping("/creator/videos")
    public ApiResponse<PageResult<Map<String, Object>>> creatorVideos(@AuthenticationPrincipal CurrentUser c,
                                                                      @RequestParam(required = false) String status,
                                                                      @RequestParam(defaultValue = "1") int page,
                                                                      @RequestParam(defaultValue = "10") int pageSize) {
        return ApiResponse.ok(service.creatorVideos(require(c), status, page, pageSize));
    }

    @GetMapping("/creator/dashboard")
    public ApiResponse<Map<String, Object>> dashboard(@AuthenticationPrincipal CurrentUser c,
                                                      @RequestParam(defaultValue = "30") int days) {
        return ApiResponse.ok(service.dashboard(require(c), days));
    }

    private long require(CurrentUser c) {
        if (c == null) throw new ApiException(ErrorCode.UNAUTHORIZED, "请先登录");
        return c.id();
    }
}
