package com.videoshare.media;

import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Advances queued uploads on the server so closing the upload page cannot strand a video. */
@Component
public class TranscodeWorker {
    private final JdbcTemplate jdbc;
    private final UploadService uploads;
    public TranscodeWorker(JdbcTemplate jdbc, UploadService uploads) { this.jdbc = jdbc; this.uploads = uploads; }

    @Scheduled(fixedDelay = 1_000L, initialDelay = 1_000L)
    public void process() {
        List<Long> ids = jdbc.query("SELECT DISTINCT video_id FROM transcode_tasks WHERE status='RUNNING' ORDER BY video_id LIMIT 8",
            (rs, row) -> rs.getLong(1));
        // 推进只发生在这里：对外接口（GET .../progress）是只读的，不会改状态。
        ids.forEach(id -> { try { uploads.advance(id); } catch (RuntimeException ignored) { /* a failed task is reported by the progress endpoint */ } });
    }
}
