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
        ids.forEach(id -> { try { uploads.progress(id); } catch (RuntimeException ignored) { /* a failed task is reported by the progress endpoint */ } });
    }
}
