package com.videoshare.config;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * 把已转码视频的 {@code hls_url} 指向多码率清单。
 *
 * <p>转码是离线步骤（{@code scripts/transcode-hls.ps1}），产物按视频 id 放在
 * {@code app.hls.root} 下。这里在启动时做一次幂等对齐：只要某视频存在
 * {@code <root>/<id>/master.m3u8}，就把它的 {@code hls_url} 设为该清单地址，使播放器
 * 的清晰度菜单出现真实档位；没有产物的视频保持原样（仍是单一 {@code /source}）。
 *
 * <p>只改开发环境（dev / dev-infra）：生产环境的 hls 地址应由转码流水线写入，
 * 不应该由应用启动时按本地目录猜测。
 */
@Component
@Profile({"dev", "dev-infra"})
public class TranscodedHlsLinker implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(TranscodedHlsLinker.class);

    private final JdbcTemplate jdbc;
    private final Path root;

    public TranscodedHlsLinker(JdbcTemplate jdbc, @Value("${app.hls.root:../data/hls}") String root) {
        this.jdbc = jdbc;
        this.root = Path.of(root).toAbsolutePath().normalize();
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        if (!Files.isDirectory(root)) return;
        List<Long> ids = jdbc.queryForList("SELECT id FROM videos WHERE status <> 'DELETED'", Long.class);
        int linked = 0;
        for (Long id : ids) {
            Path master = root.resolve(String.valueOf(id)).resolve("master.m3u8");
            if (!Files.isRegularFile(master)) continue;
            String url = "/api/v1/videos/" + id + "/hls/master.m3u8";
            String current = jdbc.queryForObject("SELECT hls_url FROM videos WHERE id=?", String.class, id);
            if (url.equals(current)) continue;
            jdbc.update("UPDATE videos SET hls_url=? WHERE id=?", url, id);
            linked++;
        }
        if (linked > 0) {
            log.info("已把 {} 个视频的 hls_url 指向多码率转码产物（目录 {}）", linked, root);
        }
    }
}
