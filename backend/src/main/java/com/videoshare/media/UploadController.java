package com.videoshare.media;

import com.videoshare.auth.CurrentUser;import com.videoshare.common.*;import jakarta.servlet.http.HttpServletRequest;import java.io.IOException;import java.util.*;import org.springframework.security.core.annotation.AuthenticationPrincipal;import org.springframework.web.bind.annotation.*;

@RestController @RequestMapping("/api/v1")
public class UploadController {
    private final UploadService service;private final IdempotencyService idempotency;public UploadController(UploadService service,IdempotencyService idempotency){this.service=service;this.idempotency=idempotency;}
    @PostMapping("/uploads/init")public ApiResponse<Map<String,Object>>init(@AuthenticationPrincipal CurrentUser c,@RequestHeader(name="Idempotency-Key",required=false)String key,@RequestBody Map<String,Object>b){long user=require(c);return ApiResponse.ok(idempotency.execute(user,"upload:init",key,()->service.init(user,b)));}
    @PutMapping("/uploads/{id}/parts/{part}")public void part(@PathVariable String id,@PathVariable int part,@RequestParam(defaultValue="0")long expires,@RequestParam(required=false)String signature,HttpServletRequest request)throws IOException{service.part(id,part,expires,signature,request.getInputStream(),request.getContentLengthLong());}
    @PostMapping("/uploads/{id}/complete")public ApiResponse<Map<String,Object>>complete(@PathVariable String id,@AuthenticationPrincipal CurrentUser c,@RequestHeader(name="Idempotency-Key",required=false)String key,@RequestBody Map<String,Object>b){List<Map<String,Object>> parts=b.get("parts")instanceof List<?>l?l.stream().filter(Map.class::isInstance).map(x->(Map<String,Object>)x).toList():List.of();long user=require(c);return ApiResponse.ok(idempotency.execute(user,"upload:complete:"+id,key,()->service.complete(user,id,parts)));}
    @PostMapping("/uploads/{id}/abort")public ApiResponse<Map<String,Boolean>>abort(@PathVariable String id,@AuthenticationPrincipal CurrentUser c){service.abort(require(c),id);return ApiResponse.ok(Map.of("success",true));}
    @GetMapping("/transcode/{videoId}/progress")public ApiResponse<Map<String,Object>>progress(@PathVariable long videoId){return ApiResponse.ok(service.progress(videoId));}
    private long require(CurrentUser c){if(c==null)throw new ApiException(ErrorCode.UNAUTHORIZED,"请先登录");return c.id();}
}
