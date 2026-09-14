package com.videoshare;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.sql.Timestamp;
import java.time.Instant;
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
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

/**
 * 性能回归护栏。
 *
 * <p>历史上视频列表每渲染一条就要发 5~6 条 SQL，页大小越大往返越多。这里用一个
 * 统计 JDBC 语句次数的 DataSource 包装器把「查询次数与页大小无关」固化成断言：
 * 一旦有人重新引入 N+1，条数会立刻随页大小增长并使测试失败。</p>
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("dev")
@Import(CountingDataSourceConfiguration.class)
class QueryCountGuardTest {

    private static final int[] PAGE_SIZES = {5, 40};

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;

    @Test
    @Transactional
    void videoListQueryCountIsIndependentOfPageSize() throws Exception {
        seedVideos(40);

        int[] statements = new int[PAGE_SIZES.length];
        for (int i = 0; i < PAGE_SIZES.length; i++) {
            CountingDataSourceConfiguration.CountingDataSource.reset();
            mvc.perform(get("/api/v1/videos/recommend")
                            .param("page", "1")
                            .param("pageSize", String.valueOf(PAGE_SIZES[i]))
                            .param("sort", "recommend"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.code").value(0))
                    .andExpect(jsonPath("$.data.items.length()").value(PAGE_SIZES[i]));
            statements[i] = CountingDataSourceConfiguration.CountingDataSource.count();
        }

        assertThat(statements[0])
                .as("批量装配后单页 SQL 条数应稳定在一个很小的常数区间")
                .isBetween(5, 15);
        assertThat(statements[1])
                .as("页大小从 %d 增加到 %d 时 SQL 条数不应增长（批量装配生效）", PAGE_SIZES[0], PAGE_SIZES[1])
                .isEqualTo(statements[0]);
    }

    @Test
    void rewrittenReadPathsStillAnswer() throws Exception {
        String token = login("laowang");
        for (String path : List.of(
                "/videos/recommend?sort=hot",
                "/videos/recommend?sort=views",
                "/videos/recommend?sort=latest",
                "/videos/1/related",
                "/videos/ranking?type=hot&period=daily",
                "/videos/ranking?type=trend&period=weekly",
                "/videos/ranking?type=views&period=all",
                "/videos/shorts?pageSize=5",
                "/users/3/followers",
                "/users/3/following",
                "/creator/dashboard?days=14",
                "/creator/videos?status=ALL",
                "/notifications?type=LIKE",
                "/feeds?type=hot",
                "/feeds?type=following")) {
            mvc.perform(get("/api/v1" + path).header("Authorization", "Bearer " + token))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.code").value(0));
        }
        String adminToken = login("admin");
        for (String path : List.of(
                "/admin/reviews?status=ALL",
                "/admin/reports?status=ALL",
                "/admin/users?keyword=lao",
                "/admin/videos?status=PUBLISHED",
                "/admin/audit-logs",
                "/admin/overview")) {
            mvc.perform(get("/api/v1" + path).header("Authorization", "Bearer " + adminToken))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.code").value(0));
        }
    }

    private void seedVideos(int count) {
        Timestamp now = Timestamp.from(Instant.now());
        for (int i = 0; i < count; i++) {
            String sha = String.format("%064x", 9000 + i);
            jdbc.update("""
                    INSERT INTO files(sha256,file_size,bucket,object_key,mime_type,ref_count,status,created_at)
                    VALUES(?,?,?,?,?,?,?,?)""", sha, 1_000L + i, "videos", "perf/" + i + ".mp4", "video/mp4", 1, "ACTIVE", now);
            Long fileId = jdbc.queryForObject("SELECT id FROM files WHERE sha256=?", Long.class, sha);
            jdbc.update("""
                    INSERT INTO videos(user_id,source_file_id,title,cover_url,hls_url,duration,file_size,video_type,
                                       category_id,visibility,status,download_enabled,view_count,like_count,comment_count,
                                       favorite_count,published_at,created_at,updated_at)
                    VALUES(3,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    fileId, "性能样本 " + i, "/favicon.svg", "/demo/hls/master.m3u8", 300 + i, 1_000L + i, "LONG",
                    (i % 3) + 1, "PUBLIC", "PUBLISHED", true, 100L * i, 10L * i, i, 5L * i, now, now, now);
        }
    }

    private String login(String account) throws Exception {
        String response = mvc.perform(post("/api/v1/auth/login")
                        .header("X-Requested-With", "XMLHttpRequest")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"account\":\"" + account + "\",\"password\":\"123456\",\"grantType\":\"PASSWORD\"}"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return json.readTree(response).path("data").path("accessToken").asString();
    }
}
