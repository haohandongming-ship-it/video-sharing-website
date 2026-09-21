package com.videoshare.media;

import com.videoshare.auth.CurrentUser;
import com.videoshare.common.ApiException;
import com.videoshare.common.ApiResponse;
import com.videoshare.common.ErrorCode;
import com.videoshare.common.IdempotencyService;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
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
public class UploadController {

    private final UploadService service;
    private final IdempotencyService idempotency;

    public UploadController(UploadService service, IdempotencyService idempotency) {
        this.service = service;
        this.idempotency = idempotency;
    }

    @PostMapping("/uploads/init")
    public ApiResponse<Map<String, Object>> init(@AuthenticationPrincipal CurrentUser c,
                                                 @RequestHeader(name = "Idempotency-Key", required = false) String key,
                                                 @RequestBody Map<String, Object> body) {
        long user = require(c);
        return ApiResponse.ok(idempotency.execute(user, "upload:init", key, () -> service.init(user, body)));
    }

    @PutMapping("/uploads/{id}/parts/{part}")
    public void part(@PathVariable String id, @PathVariable int part,
                     @RequestParam(defaultValue = "0") long expires,
                     @RequestParam(required = false) String signature,
                     HttpServletRequest request) throws IOException {
        service.part(id, part, expires, signature, request.getInputStream(), request.getContentLengthLong());
    }

    @PostMapping("/uploads/{id}/complete")
    public ApiResponse<Map<String, Object>> complete(@PathVariable String id,
                                                     @AuthenticationPrincipal CurrentUser c,
                                                     @RequestHeader(name = "Idempotency-Key", required = false) String key,
                                                     @RequestBody Map<String, Object> body) {
        List<Map<String, Object>> parts = parts(body.get("parts"));
        long user = require(c);
        return ApiResponse.ok(idempotency.execute(user, "upload:complete:" + id, key, () -> service.complete(user, id, parts)));
    }

    @PostMapping("/uploads/{id}/abort")
    public ApiResponse<Map<String, Boolean>> abort(@PathVariable String id, @AuthenticationPrincipal CurrentUser c) {
        service.abort(require(c), id);
        return ApiResponse.ok(Map.of("success", true));
    }

    /**
     * 转码进度查询：只读。
     *
     * <p>状态推进已移出 HTTP 层（由 {@link TranscodeWorker} 定时完成），因此这个 GET
     * 不会再修改任何数据；同时要求登录且仅作者本人 / 管理员 / 审核员可读。</p>
     */
    @GetMapping("/transcode/{videoId}/progress")
    public ApiResponse<Map<String, Object>> progress(@PathVariable long videoId,
                                                     @AuthenticationPrincipal CurrentUser c) {
        return ApiResponse.ok(service.snapshot(videoId, c));
    }

    /** 把任意 JSON 数组规整成 {@code List<Map<String,Object>>}，避免未检查的强制转换。 */
    private static List<Map<String, Object>> parts(Object value) {
        if (!(value instanceof List<?> list)) return List.of();
        List<Map<String, Object>> parts = new ArrayList<>(list.size());
        for (Object item : list) {
            if (!(item instanceof Map<?, ?> raw)) continue;
            Map<String, Object> part = new LinkedHashMap<>();
            raw.forEach((key, val) -> part.put(String.valueOf(key), val));
            parts.add(part);
        }
        return parts;
    }

    private long require(CurrentUser c) {
        if (c == null) throw new ApiException(ErrorCode.UNAUTHORIZED, "请先登录");
        return c.id();
    }
}
