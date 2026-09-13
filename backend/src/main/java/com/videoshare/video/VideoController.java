package com.videoshare.video;

import com.videoshare.auth.CurrentUser; import com.videoshare.common.ApiResponse; import jakarta.validation.Valid; import jakarta.validation.constraints.*; import org.springframework.security.core.annotation.AuthenticationPrincipal; import org.springframework.web.bind.annotation.*;

@RestController @RequestMapping("/api/v1/videos")
public class VideoController {
    private final VideoService service; public VideoController(VideoService service){this.service=service;}
    @GetMapping("/{id}") public ApiResponse<VideoDtos.Detail> detail(@PathVariable long id){return ApiResponse.ok(service.detail(id));}
    @GetMapping({"/recommend","/ranking"}) public ApiResponse<VideoDtos.PageData<VideoDtos.Detail>> discover(@RequestParam(required=false) String q,@RequestParam(defaultValue="1") @Min(1) int page,@RequestParam(defaultValue="20") @Min(1) @Max(100) int pageSize){return ApiResponse.ok(service.discover(q,page,pageSize));}
    @GetMapping("/search") public ApiResponse<VideoDtos.PageData<VideoDtos.Detail>> search(@RequestParam @NotBlank String q,@RequestParam(defaultValue="1") @Min(1) int page,@RequestParam(defaultValue="20") @Min(1) @Max(100) int pageSize){return ApiResponse.ok(service.discover(q,page,pageSize));}
    @PutMapping("/{id}") public ApiResponse<VideoDtos.Detail> edit(@PathVariable long id,@AuthenticationPrincipal CurrentUser current,@Valid @RequestBody VideoDtos.EditRequest request){return ApiResponse.ok(service.edit(id,current,request));}
    @DeleteMapping("/{id}") public ApiResponse<Void> delete(@PathVariable long id,@AuthenticationPrincipal CurrentUser current){service.delete(id,current);return ApiResponse.ok(null);}
}
