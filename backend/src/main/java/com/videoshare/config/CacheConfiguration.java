package com.videoshare.config;

import com.github.benmanes.caffeine.cache.Caffeine;
import java.time.Duration;
import java.util.List;
import org.springframework.cache.CacheManager;
import org.springframework.cache.annotation.EnableCaching;
import org.springframework.cache.caffeine.CaffeineCache;
import org.springframework.cache.support.SimpleCacheManager;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 进程内缓存。
 *
 * <p>只缓存「读多写少、允许短暂陈旧」的数据，并按缓存分别设置容量与 TTL，
 * 避免像早期的无界 Map 那样把内存交给无上限的键空间。多实例部署时这些缓存
 * 各自独立，不会影响正确性（最坏情况只是多查一次数据库）。</p>
 */
@Configuration
@EnableCaching
public class CacheConfiguration {

    public static final String CATEGORIES = "catalog:categories";
    public static final String SUGGESTED_USERS = "feed:suggested";

    @Bean
    public CacheManager cacheManager() {
        SimpleCacheManager manager = new SimpleCacheManager();
        // recordStats() 让 /actuator/metrics 能给出命中率，便于判断 TTL 是否合理。
        manager.setCaches(List.of(
                new CaffeineCache(CATEGORIES, Caffeine.newBuilder()
                        .maximumSize(64)
                        .expireAfterWrite(Duration.ofMinutes(10))
                        .recordStats()
                        .build()),
                new CaffeineCache(SUGGESTED_USERS, Caffeine.newBuilder()
                        .maximumSize(1_000)
                        .expireAfterWrite(Duration.ofSeconds(60))
                        .recordStats()
                        .build())));
        return manager;
    }
}
