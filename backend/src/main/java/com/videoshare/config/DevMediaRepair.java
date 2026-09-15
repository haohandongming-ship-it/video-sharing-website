package com.videoshare.config;

import com.videoshare.media.StorageProperties;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.HexFormat;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.core.annotation.Order;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/** Repair only explicitly identified development seeds, never substitute a user's uploaded source. */
@Component @Profile("dev") @Order(1)
@ConditionalOnProperty(name="app.storage.mode", havingValue="local", matchIfMissing=true)
public class DevMediaRepair implements ApplicationRunner {
    private final JdbcTemplate jdbc;
    private final StorageProperties properties;
    public DevMediaRepair(JdbcTemplate jdbc, StorageProperties properties) { this.jdbc=jdbc; this.properties=properties; }
    @Override @Transactional
    public void run(ApplicationArguments args) throws Exception {
        var ids=jdbc.queryForList("SELECT v.id FROM videos v JOIN files f ON f.id=v.source_file_id WHERE f.object_key LIKE 'demo/%'",Long.class);
        if(ids.isEmpty()) return;
        byte[] bytes;
        try(var input=getClass().getResourceAsStream("/demo/sample.mp4")) {
            if(input==null) throw new IllegalStateException("Bundled development video missing");
            bytes=input.readAllBytes();
        }
        String sha=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        String object="media/source/"+sha+".bin";
        Path root=Path.of(properties.localRoot()).toAbsolutePath().normalize();
        Path target=root.resolve(object); Files.createDirectories(target.getParent()); Files.write(target,bytes);
        if(jdbc.queryForObject("SELECT COUNT(*) FROM files WHERE sha256=? AND file_size=?",Integer.class,sha,bytes.length)==0)
            jdbc.update("INSERT INTO files(sha256,file_size,bucket,object_key,mime_type,ref_count,status) VALUES(?,?,'local',?,'video/mp4',?,'ACTIVE')",sha,bytes.length,object,ids.size());
        Long file=jdbc.queryForObject("SELECT id FROM files WHERE sha256=? AND file_size=?",Long.class,sha,bytes.length);
        // Point the seeded demo videos at the bundled clip. View counts are historical and only ever incremented,
        // so they are deliberately left alone: a restart must not wipe what the demo accumulated.
        for(Long id:ids) jdbc.update("UPDATE videos SET source_file_id=?,file_size=?,duration=15,hls_url=? WHERE id=?",file,bytes.length,"/api/v1/videos/"+id+"/source",id);
    }
}
