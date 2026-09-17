package com.videoshare.config;

import com.videoshare.media.StorageGateway;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Replace the placeholder source rows created by the seeder with the bundled development clip.
 *
 * <p>Why this is needed: the seeder writes {@code demo/N.mp4} rows with an all-zero SHA, so the seeds
 * would 404 on playback until a real object exists behind the file row. This runner stores the
 * bundled clip and re-points the seeds at it.
 *
 * <p>{@code hls_url} 指向随包的多码率演示流 {@code /api/v1/demo/hls/master.m3u8}
 * （见 {@link DemoSegmentController}），使播放器的清晰度菜单有真实档位可切。
 * 注意不能再用 {@code /demo/} 开头的旧地址：读取路径会把该前缀映射回 {@code /source}。
 *
 * <p>It runs for both {@code dev} (local directory storage) and {@code dev-infra} (MinIO via Docker);
 * going through {@link StorageGateway} keeps it storage-agnostic. Only explicitly identified seed rows
 * are touched — a user's uploaded source is never substituted.
 */
@Component @Profile({"dev","dev-infra"}) @Order(1)
public class DevMediaRepair implements ApplicationRunner {
    private final JdbcTemplate jdbc;
    private final StorageGateway storage;
    public DevMediaRepair(JdbcTemplate jdbc, StorageGateway storage) { this.jdbc=jdbc; this.storage=storage; }
    @Override @Transactional
    public void run(ApplicationArguments args) throws Exception {
        /*
         * 同时按两种特征识别开发种子视频：
         * 1) DevDataSeeder 写入的占位文件行（object_key 形如 demo/N.mp4）；
         * 2) 种子标题本身。
         * 只用第 1 条不够：首次修复后视频已改指向 media/source/*.bin，占位行不再匹配，
         * 于是后续新增的修复逻辑（例如把 hls_url 指向多码率演示流）永远不会执行。
         */
        List<Long> ids=jdbc.queryForList("""
                SELECT v.id FROM videos v LEFT JOIN files f ON f.id=v.source_file_id
                WHERE v.title LIKE '光影视频示例 %' OR f.object_key LIKE 'demo/%'""",Long.class);
        if(ids.isEmpty()) return;
        byte[] bytes;
        try(var input=getClass().getResourceAsStream("/demo/sample.mp4")) {
            if(input==null) throw new IllegalStateException("Bundled development video missing");
            bytes=input.readAllBytes();
        }
        String sha=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        String object="media/source/"+sha+".bin";
        // 幂等：对象已存在时重复写入是安全的（同一 key、同一内容）
        storage.putObject(object,new java.io.ByteArrayInputStream(bytes),bytes.length,"video/mp4");
        if(jdbc.queryForObject("SELECT COUNT(*) FROM files WHERE sha256=? AND file_size=?",Integer.class,sha,bytes.length)==0)
            jdbc.update("INSERT INTO files(sha256,file_size,bucket,object_key,mime_type,ref_count,status) VALUES(?,?,?,?,'video/mp4',?,'ACTIVE')",
                    sha,bytes.length,storage.bucket(),object,ids.size());        Long file=jdbc.queryForObject("SELECT id FROM files WHERE sha256=? AND file_size=?",Long.class,sha,bytes.length);
        // Point the seeded demo videos at the bundled clip. View counts are historical and only ever incremented,
        // so they are deliberately left alone: a restart must not wipe what the demo accumulated.
        //
        // hls_url 指向随包的多码率演示流（360p/540p/720p，见 DemoSegmentController），
        // 而不是单一 /source：此前指向 /source 会让播放器的清晰度菜单永远没有档位可切。
        // 源文件仍然保留，/api/v1/videos/{id}/source 的 Range 播放路径不受影响。
        for(Long id:ids) jdbc.update("UPDATE videos SET source_file_id=?,file_size=?,duration=15,hls_url=? WHERE id=?",
                file,bytes.length,"/api/v1/demo/hls/master.m3u8",id);
    }
}
