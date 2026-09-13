package com.videoshare.video;

import jakarta.validation.constraints.*; import java.time.Instant; import java.util.*;
public final class VideoDtos {
    private VideoDtos() { }
    public record EditRequest(@NotBlank @Size(max=200) String title, @Size(max=5000) String description, @NotNull Long categoryId, @NotNull Visibility visibility, boolean downloadEnabled) { }
    public record Author(long id,String nickname) { }
    public record Stats(long views,long likes,long comments,long favorites) { }
    public record Detail(long id,VideoType videoType,String title,String description,String coverUrl,int duration,long categoryId,Author author,Stats stats,VideoStatus status,Instant publishedAt,boolean downloadEnabled) { }
    public record PageData<T>(List<T> items,long total,int page,int pageSize) { }
}
