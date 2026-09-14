package com.videoshare.common;

import java.util.List;

/**
 * 统一分页信封。
 *
 * <p>序列化后的字段名（items/total/page/pageSize/hasMore）与旧版 {@code Map} 实现完全一致，
 * 因此前端契约不变；同时用 record 表达不可变的分页结果，消除了此前散落在
 * ViewFactory、InteractionService、UserApiService、AdminService、SocialService
 * 中的五份重复 {@code page(...)} 实现。</p>
 */
public record PageResult<T>(List<T> items, long total, int page, int pageSize, boolean hasMore) {

    /** 单页最大条目数，避免客户端用超大 pageSize 触发全表扫描。 */
    public static final int MAX_PAGE_SIZE = 100;

    public static <T> PageResult<T> of(List<T> items, long total, int page, int pageSize) {
        int normalizedPage = Math.max(1, page);
        int normalizedSize = Math.clamp(pageSize, 1, MAX_PAGE_SIZE);
        return new PageResult<>(List.copyOf(items), total, normalizedPage, normalizedSize,
                (long) normalizedPage * normalizedSize < total);
    }

    public static <T> PageResult<T> empty(int page, int pageSize) {
        return of(List.of(), 0, page, pageSize);
    }

    /** 对已经在内存中的完整列表分页；仅在数据量天然有界的场景使用。 */
    public static <T> PageResult<T> slice(List<T> all, int page, int pageSize) {
        int normalizedPage = Math.max(1, page);
        int normalizedSize = Math.clamp(pageSize, 1, MAX_PAGE_SIZE);
        int from = (int) Math.min((long) (normalizedPage - 1) * normalizedSize, all.size());
        int to = Math.min(from + normalizedSize, all.size());
        return of(all.subList(from, to), all.size(), normalizedPage, normalizedSize);
    }

    /**
     * 游标式分页：把 {@code [offset, offset+size)} 窗口裁剪到实际数据范围内。
     * 用于 shorts / feeds 这类 cursor + nextCursor 接口。
     */
    public static <T> CursorSlice<T> cursor(List<T> all, int offset, int size) {
        int normalizedOffset = Math.max(0, Math.min(offset, all.size()));
        int normalizedSize = Math.clamp(size, 1, MAX_PAGE_SIZE);
        int to = (int) Math.min((long) normalizedOffset + normalizedSize, all.size());
        List<T> window = List.copyOf(all.subList(normalizedOffset, to));
        return new CursorSlice<>(window, to < all.size() ? String.valueOf(to) : null);
    }

    /** 游标窗口结果：{@code nextCursor} 为 null 表示已经到底。 */
    public record CursorSlice<T>(List<T> items, String nextCursor) {
        public boolean hasMore() {
            return nextCursor != null;
        }
    }
}
