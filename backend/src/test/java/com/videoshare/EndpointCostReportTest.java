package com.videoshare;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;

/**
 * 端点开销测量夹具：记录每个接口的 SQL 语句条数、响应体字节数与页大小缩放曲线。
 * 结果写入 target/perf/*.tsv，供性能报告使用。
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("dev")
@Import({CountingDataSourceConfiguration.class, SynchronousAsyncTestConfiguration.class})
class EndpointCostReportTest {

    private static final int SEED_VIDEOS = 60;
    private static final int SEED_PERSONAL_ROWS = 24;
    private static final int[] PAGE_SIZES = {5, 10, 20, 40};
    private static final int WARMUP = 5;
    private static final int SAMPLES = 15;

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;

    @Test
    @Transactional
    void reportEndpointCost() throws Exception {
        seed();
        String user = login("laowang");
        String admin = login("admin");

        List<Case> cases = List.of(
                new Case("GET /videos/recommend?pageSize=20", "/api/v1/videos/recommend?pageSize=20", null),
                new Case("GET /videos/recommend?sort=hot&pageSize=20", "/api/v1/videos/recommend?sort=hot&pageSize=20", null),
                new Case("GET /videos/search?q=光影&pageSize=20", "/api/v1/videos/search?q=光影&pageSize=20", null),
                new Case("GET /videos/1", "/api/v1/videos/1", null),
                new Case("GET /videos/1/related", "/api/v1/videos/1/related", null),
                new Case("GET /videos/1/comments", "/api/v1/videos/1/comments", null),
                new Case("GET /videos/ranking?type=hot", "/api/v1/videos/ranking?type=hot", null),
                new Case("GET /videos/shorts?pageSize=10", "/api/v1/videos/shorts?pageSize=10", null),
                new Case("GET /users/3", "/api/v1/users/3", null),
                new Case("GET /users/3/videos", "/api/v1/users/3/videos", null),
                new Case("GET /users/3/followers", "/api/v1/users/3/followers", null),
                new Case("GET /feeds?pageSize=10", "/api/v1/feeds?pageSize=10", null),
                new Case("GET /notifications", "/api/v1/notifications", user),
                new Case("GET /videos/history", "/api/v1/videos/history", user),
                new Case("GET /videos/favorites", "/api/v1/videos/favorites", user),
                new Case("GET /creator/dashboard", "/api/v1/creator/dashboard", user),
                new Case("GET /messages/conversations", "/api/v1/messages/conversations", user),
                new Case("GET /admin/users", "/api/v1/admin/users", admin),
                new Case("GET /admin/overview", "/api/v1/admin/overview", admin));

        List<String> lines = new ArrayList<>();
        lines.add("endpoint\tsql_statements\tpayload_bytes\tlatency_p50_ms");
        for (Case testCase : cases) {
            long[] timings = new long[SAMPLES];
            MvcResult last = null;
            for (int i = 0; i < WARMUP + SAMPLES; i++) {
                long started = System.nanoTime();
                last = mvc.perform(request(testCase)).andExpect(status().isOk()).andReturn();
                long elapsed = System.nanoTime() - started;
                if (i >= WARMUP) timings[i - WARMUP] = elapsed;
            }
            CountingDataSourceConfiguration.CountingDataSource.reset();
            mvc.perform(request(testCase)).andExpect(status().isOk());
            int statements = CountingDataSourceConfiguration.CountingDataSource.count();
            java.util.Arrays.sort(timings);
            lines.add(testCase.label() + "\t" + statements + "\t"
                    + last.getResponse().getContentAsByteArray().length + "\t"
                    + String.format("%.2f", timings[SAMPLES / 2] / 1_000_000.0));
        }
        write("endpoint-cost.tsv", lines);
    }

    @Test
    @Transactional
    void reportPageScaling() throws Exception {
        seed();
        List<String> lines = new ArrayList<>();
        lines.add("page_size\tsql_statements\tpayload_bytes\tlatency_p50_ms");
        for (int size : PAGE_SIZES) {
            Case testCase = new Case("recommend", "/api/v1/videos/recommend?pageSize=" + size, null);
            long[] timings = new long[SAMPLES];
            MvcResult last = null;
            for (int i = 0; i < WARMUP + SAMPLES; i++) {
                long started = System.nanoTime();
                last = mvc.perform(request(testCase)).andExpect(status().isOk()).andReturn();
                long elapsed = System.nanoTime() - started;
                if (i >= WARMUP) timings[i - WARMUP] = elapsed;
            }
            CountingDataSourceConfiguration.CountingDataSource.reset();
            mvc.perform(request(testCase)).andExpect(status().isOk());
            java.util.Arrays.sort(timings);
            lines.add(size + "\t" + CountingDataSourceConfiguration.CountingDataSource.count() + "\t"
                    + last.getResponse().getContentAsByteArray().length + "\t"
                    + String.format("%.2f", timings[SAMPLES / 2] / 1_000_000.0));
        }
        write("page-scaling.tsv", lines);
    }

    @Test
    @Transactional
    void reportCommentScaling() throws Exception {
        seed();
        for (int i = 0; i < 50; i++) {
            jdbc.update("INSERT INTO comments(video_id,user_id,content,status) VALUES(?,?,?,'VISIBLE')",
                    1L, 4L, "压力评论 " + i);
        }
        List<String> lines = new ArrayList<>();
        lines.add("page_size\ttotal_comments\tsql_statements\tpayload_bytes\tlatency_p50_ms");
        for (int size : new int[]{10, 50}) {
            Case testCase = new Case("comments", "/api/v1/videos/1/comments?pageSize=" + size, null);
            long[] timings = new long[SAMPLES];
            MvcResult last = null;
            for (int i = 0; i < WARMUP + SAMPLES; i++) {
                long started = System.nanoTime();
                last = mvc.perform(request(testCase)).andExpect(status().isOk()).andReturn();
                long elapsed = System.nanoTime() - started;
                if (i >= WARMUP) timings[i - WARMUP] = elapsed;
            }
            CountingDataSourceConfiguration.CountingDataSource.reset();
            mvc.perform(request(testCase)).andExpect(status().isOk());
            java.util.Arrays.sort(timings);
            lines.add(size + "\t50\t" + CountingDataSourceConfiguration.CountingDataSource.count() + "\t"
                    + last.getResponse().getContentAsByteArray().length + "\t"
                    + String.format("%.2f", timings[SAMPLES / 2] / 1_000_000.0));
        }
        write("comment-scaling.tsv", lines);
    }

    private void write(String name, List<String> lines) throws Exception {
        Path out = Path.of("target", "perf", name);
        Files.createDirectories(out.getParent());
        Files.write(out, lines);
        System.out.println("REPORT_WRITTEN " + out.toAbsolutePath());
        lines.forEach(System.out::println);
    }

    private org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder request(Case testCase) {
        var builder = get(testCase.path());
        if (testCase.token() != null) builder.header("Authorization", "Bearer " + testCase.token());
        return builder;
    }

    private void seed() {
        Timestamp now = Timestamp.from(Instant.now());
        for (int i = 0; i < SEED_VIDEOS; i++) {
            String sha = String.format("%064x", 7000 + i);
            jdbc.update("""
                    INSERT INTO files(sha256,file_size,bucket,object_key,mime_type,ref_count,status,created_at)
                    VALUES(?,?,?,?,?,?,?,?)""", sha, 1_000L + i, "videos", "perf/" + i + ".mp4", "video/mp4", 1, "ACTIVE", now);
            Long fileId = jdbc.queryForObject("SELECT id FROM files WHERE sha256=?", Long.class, sha);
            jdbc.update("""
                    INSERT INTO videos(user_id,source_file_id,title,cover_url,hls_url,duration,file_size,video_type,
                                       category_id,visibility,status,download_enabled,view_count,like_count,comment_count,
                                       favorite_count,published_at,created_at,updated_at)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    3L + (i % 2), fileId, "开销样本 " + i, "/favicon.svg", "/demo/hls/master.m3u8",
                    300 + i, 1_000L + i, "LONG", (i % 3) + 1, "PUBLIC", "PUBLISHED", true,
                    100L * i, 10L * i, i % 50, 5L * i, now, now, now);
        }
        // dev 种子已为 user 3 建过 1 条播放记录与 1 条收藏，先清空以获得确定性的规模。
        jdbc.update("DELETE FROM play_records WHERE user_id=3");
        jdbc.update("DELETE FROM favorites WHERE user_id=3");
        jdbc.update("DELETE FROM notifications WHERE user_id=3");
        Long folderId = jdbc.queryForObject("SELECT id FROM folders WHERE user_id=3 ORDER BY id LIMIT 1", Long.class);
        List<Long> videoIds = jdbc.queryForList("SELECT id FROM videos ORDER BY id LIMIT " + SEED_PERSONAL_ROWS, Long.class);
        for (Long videoId : videoIds) {
            jdbc.update("INSERT INTO play_records(user_id,video_id,progress,finished,updated_at) VALUES(?,?,?,?,?)",
                    3L, videoId, 30, false, now);
            jdbc.update("INSERT INTO favorites(user_id,video_id,folder_id) VALUES(?,?,?)", 3L, videoId, folderId);
            jdbc.update("""
                    INSERT INTO notifications(user_id,actor_id,type,title,content,target_type,target_id,is_read)
                    VALUES(?,?,?,?,?,?,?,?)""", 3L, 4L, "LIKE", "获得点赞", "有人赞了你的视频", "VIDEO", videoId, false);
        }
    }

    private String login(String account) throws Exception {
        MvcResult result = mvc.perform(post("/api/v1/auth/login")
                        .header("X-Requested-With", "XMLHttpRequest")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(("{\"account\":\"" + account + "\",\"password\":\"123456\",\"grantType\":\"PASSWORD\"}").getBytes(StandardCharsets.UTF_8)))
                .andExpect(status().isOk())
                .andReturn();
        String body = result.getResponse().getContentAsString();
        int index = body.indexOf("\"accessToken\":\"");
        if (index < 0) throw new IllegalStateException("no token in " + body);
        int start = index + "\"accessToken\":\"".length();
        return body.substring(start, body.indexOf('"', start));
    }

    private record Case(String label, String path, String token) { }

}
