package com.videoshare;

import com.videoshare.interaction.InteractionService;
import jakarta.servlet.http.Cookie;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.ObjectMapper;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest @AutoConfigureMockMvc @ActiveProfiles("dev")
@Import({CountingDataSourceConfiguration.class, SynchronousAsyncTestConfiguration.class})
class ReportRegressionTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired InteractionService interactions;

    private String login(String account) throws Exception {
        return login(account,"123456");
    }

    private String login(String account,String password) throws Exception {
        var result=mvc.perform(post("/api/v1/auth/login").header("X-Requested-With","XMLHttpRequest")
                .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(Map.of("account",account,"password",password,"grantType","PASSWORD"))))
                .andExpect(status().isOk()).andExpect(cookie().httpOnly("video_media",true)).andReturn();
        return json.readTree(result.getResponse().getContentAsString()).at("/data/accessToken").asString();
    }

    @Test void invalidParametersAreClientErrors() throws Exception {
        mvc.perform(get("/api/v1/videos/recommend?pageSize=99999")).andExpect(status().isBadRequest());
        mvc.perform(get("/api/v1/videos")).andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/videos/1/source").header("Range","bytes=999999999999999999999-")).andExpect(status().isRequestedRangeNotSatisfiable());
    }

    @Test void seedSourceIsRealAndRangeContainsOnlyRequestedBytes() throws Exception {
        byte[] expected;
        try(var input=getClass().getResourceAsStream("/demo/sample.mp4")) { expected=input.readAllBytes(); }
        var result=mvc.perform(get("/api/v1/videos/1/source").header("Range","bytes=100-199"))
                .andExpect(status().isPartialContent()).andExpect(header().string("Content-Length","100")).andReturn();
        var response=mvc.perform(asyncDispatch(result)).andExpect(status().isPartialContent()).andReturn().getResponse();
        assertArrayEquals(Arrays.copyOfRange(expected,100,200),response.getContentAsByteArray());
    }

    @Test void nativeMediaCookieAuthorizesOnlyMediaAndLogoutClearsIt() throws Exception {
        String token=login("laowang");
        mvc.perform(get("/api/v1/videos/3/source")).andExpect(status().isNotFound());
        var result=mvc.perform(get("/api/v1/videos/3/source").cookie(new Cookie("video_media",token)).header("Range","bytes=0-31"))
                .andExpect(status().isPartialContent()).andReturn();
        mvc.perform(asyncDispatch(result)).andExpect(status().isPartialContent());
        mvc.perform(get("/api/v1/users/me").cookie(new Cookie("video_media",token))).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/v1/auth/logout").header("Authorization","Bearer "+token).header("X-Requested-With","XMLHttpRequest"))
                .andExpect(status().isOk()).andExpect(cookie().maxAge("video_media",0)).andExpect(cookie().maxAge("video_refresh",0));
    }

    @Test void repeatedBadPasswordsAreRateLimited() throws Exception {
        for(int i=0;i<6;i++) mvc.perform(post("/api/v1/auth/login").header("X-Requested-With","XMLHttpRequest")
                .contentType(MediaType.APPLICATION_JSON).content("{\"account\":\"rate-test-missing\",\"password\":\"invalid\"}"))
                .andExpect(status().is(i<5?401:429));
    }

    @Test void failureBudgetsArePerIdentityAndResetOnSuccess() throws Exception {
        mvc.perform(post("/api/v1/auth/register").header("X-Requested-With","XMLHttpRequest")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"throttleprobe\",\"email\":\"throttleprobe@example.com\",\"phone\":\"13900000098\",\"password\":\"probe-password-123\",\"nickname\":\"限流探针\",\"agreeTerms\":true}"))
                .andExpect(status().isOk());
        for(int i=0;i<3;i++) mvc.perform(post("/api/v1/auth/login").header("X-Requested-With","XMLHttpRequest")
                .contentType(MediaType.APPLICATION_JSON).content("{\"account\":\"throttleprobe\",\"password\":\"wrong\"}"))
                .andExpect(status().isUnauthorized());
        // 成功一次即清零：否则零星的输错会累积成永久锁定。
        login("throttleprobe","probe-password-123");
        for(int i=0;i<4;i++) mvc.perform(post("/api/v1/auth/login").header("X-Requested-With","XMLHttpRequest")
                .contentType(MediaType.APPLICATION_JSON).content("{\"account\":\"throttleprobe\",\"password\":\"wrong\"}"))
                .andExpect(status().isUnauthorized());
        login("throttleprobe","probe-password-123");
        // 预算按「认证标识」划分：同一出口地址下的其他账号不被牵连（反代/局域网共用 IP 的前提）。
        login("newbie");
        login("laowang");
    }

    @Test void smsVerificationIsRateLimitedPerPhoneAndNotByRotatingAccount() throws Exception {
        for(int i=0;i<6;i++) mvc.perform(post("/api/v1/auth/login").header("X-Requested-With","XMLHttpRequest")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"grantType\":\"SMS\",\"phone\":\"13900000099\",\"account\":\"rotate-"+i+"\",\"code\":\"000000\"}"))
                .andExpect(status().is(i<5?401:429));
        for(int i=0;i<6;i++) mvc.perform(post("/api/v1/auth/password/reset").header("X-Requested-With","XMLHttpRequest")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"phone\":\"13900000099\",\"code\":\"000000\",\"password\":\"new-password-123\"}"))
                .andExpect(status().is(i<5?401:429));
    }

    @Test void deletingARepostReleasesTheOriginalCounter() throws Exception {
        String token=login("newbie");
        int baseline=jdbc.queryForObject("SELECT repost_count FROM feeds WHERE id=1",Integer.class);
        var created=mvc.perform(post("/api/v1/feeds").header("Authorization","Bearer "+token)
                .header("X-Requested-With","XMLHttpRequest").contentType(MediaType.APPLICATION_JSON)
                .content("{\"content\":\"转发回归\",\"repostOfId\":1}")).andExpect(status().isOk()).andReturn();
        long repostId=json.readTree(created.getResponse().getContentAsString()).at("/data/id").asLong();
        assertEquals(baseline+1,jdbc.queryForObject("SELECT repost_count FROM feeds WHERE id=1",Integer.class));
        mvc.perform(delete("/api/v1/feeds/"+repostId).header("Authorization","Bearer "+token)
                .header("X-Requested-With","XMLHttpRequest")).andExpect(status().isOk());
        assertEquals(baseline,jdbc.queryForObject("SELECT repost_count FROM feeds WHERE id=1",Integer.class));
    }

    @Test void progressSurvivesVideosWithoutDurationMetadata() throws Exception {
        long user=jdbc.queryForObject("SELECT id FROM users WHERE username='newbie'",Long.class);
        Long fileId=jdbc.queryForObject("SELECT id FROM files WHERE object_key LIKE 'demo/%' ORDER BY id LIMIT 1",Long.class);
        jdbc.update("INSERT INTO videos(user_id,source_file_id,title,description,duration,file_size,video_type,category_id,visibility,status,download_enabled,published_at,created_at,updated_at) VALUES(?,?,?,?,0,1024,'LONG',1,'PUBLIC','PUBLISHED',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
                user,fileId,"未转码视频","duration 元数据缺失");
        long videoId=jdbc.queryForObject("SELECT MAX(id) FROM videos",Long.class);
        interactions.progress(user,videoId,42);
        var saved=jdbc.queryForMap("SELECT progress,finished FROM play_records WHERE user_id=? AND video_id=?",user,videoId);
        assertEquals(42L,((Number)saved.get("progress")).longValue());
        assertEquals(false,saved.get("finished"));
    }

    @Test void securityHeadersAreScopedAndSuffixRangesWork() throws Exception {
        mvc.perform(get("/api/v1/videos/1")).andExpect(status().isOk())
                .andExpect(header().string("Content-Security-Policy",org.hamcrest.Matchers.startsWith("default-src 'none'")))
                // HSTS 只在安全连接上发送：明文请求带这个头没有意义。
                .andExpect(header().doesNotExist("Strict-Transport-Security"));
        mvc.perform(get("/api/v1/videos/1").secure(true)).andExpect(status().isOk())
                .andExpect(header().string("Strict-Transport-Security",org.hamcrest.Matchers.containsString("max-age=31536000")));
        // 开发文档是 HTML+内联脚本，不能套用接口用的严格策略，否则 swagger-ui 白屏。
        mvc.perform(get("/v3/api-docs")).andExpect(status().isOk())
                .andExpect(header().string("Content-Security-Policy",org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("default-src 'none'"))));
        byte[] expected;
        try(var input=getClass().getResourceAsStream("/demo/sample.mp4")) { expected=input.readAllBytes(); }
        var suffix=mvc.perform(get("/api/v1/videos/1/source").header("Range","bytes=-100"))
                .andExpect(status().isPartialContent()).andExpect(header().string("Content-Length","100")).andReturn();
        var response=mvc.perform(asyncDispatch(suffix)).andExpect(status().isPartialContent()).andReturn().getResponse();
        assertArrayEquals(Arrays.copyOfRange(expected,expected.length-100,expected.length),response.getContentAsByteArray());
        // 多区间等无法处理的 Range 按 RFC 9110 忽略，返回完整内容。
        mvc.perform(get("/api/v1/videos/1/source").header("Range","bytes=0-99,200-299")).andExpect(status().isOk());
    }

    @Test void concurrentIdenticalReactionsStayIdempotent() throws Exception {
        long user=jdbc.queryForObject("SELECT id FROM users WHERE username='newbie'",Long.class);
        int baseline=jdbc.queryForObject("SELECT COUNT(*) FROM favorites WHERE video_id=2",Integer.class);
        try(var executor=Executors.newVirtualThreadPerTaskExecutor()) {
            try {
                List<Callable<Map<String,Object>>> jobs=new ArrayList<>();
                for(int i=0;i<24;i++) jobs.add(()->interactions.favorite(user,2,true,null));
                for(var job:executor.invokeAll(jobs)) assertEquals(true,job.get().get("active"));
                assertEquals(1,jdbc.queryForObject("SELECT COUNT(*) FROM favorites WHERE user_id=? AND video_id=2",Integer.class,user));
                assertEquals(baseline+1,jdbc.queryForObject("SELECT favorite_count FROM videos WHERE id=2",Integer.class));
            } finally { interactions.favorite(user,2,false,null); }
        }
    }

    @Test @org.springframework.transaction.annotation.Transactional
    void reportDescriptionSurvivesSubmissionAndAdminRead() throws Exception {
        String token=login("laowang");
        var result=mvc.perform(post("/api/v1/reports").header("Authorization","Bearer "+token).header("X-Requested-With","XMLHttpRequest")
                .contentType(MediaType.APPLICATION_JSON).content("{\"targetType\":\"VIDEO\",\"targetId\":1,\"reason\":\"SPAM\",\"description\":\"报告回归：第 3 秒出现问题\"}"))
                .andExpect(status().isOk()).andReturn();
        long id=json.readTree(result.getResponse().getContentAsString()).at("/data/reportId").asLong();
        assertEquals("报告回归：第 3 秒出现问题",jdbc.queryForObject("SELECT description FROM reports WHERE id=?",String.class,id));
        mvc.perform(get("/api/v1/admin/reports").header("Authorization","Bearer "+login("admin")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.items[?(@.id=="+id+")].description").value(org.hamcrest.Matchers.hasItem("报告回归：第 3 秒出现问题")));
    }

    /**
     * 回归 SEC-01：GET /api/v1/transcode/{id}/progress 必须「只读 + 需鉴权 + 限定属主」。
     *
     * <p>修复前该接口匿名可达，且会在 GET 里推进 {@code transcode_tasks.progress}，
     * 任何匿名调用者都能把任意视频一路推过转码门槛（实测 5 → 25 → 45 → 65 → SUCCESS）。
     * 现在状态推进只在 {@code TranscodeWorker} 的定时任务里发生。</p>
     *
     * <p>断言用的任务状态是 {@code QUEUED}：{@code TranscodeWorker} 只处理 {@code RUNNING}，
     * 因此这条任务的进度若发生变化，必定来自被测接口本身，断言不受定时任务干扰。</p>
     */
    @Test void transcodeProgressIsReadOnlyAndScopedToOwner() throws Exception {
        long owner=jdbc.queryForObject("SELECT id FROM users WHERE username='laowang'",Long.class);
        Long fileId=jdbc.queryForObject("SELECT id FROM files WHERE object_key LIKE 'demo/%' ORDER BY id LIMIT 1",Long.class);
        jdbc.update("INSERT INTO videos(user_id,source_file_id,title,description,duration,file_size,video_type,category_id,visibility,status,download_enabled,published_at,created_at,updated_at) VALUES(?,?,?,?,15,1024,'LONG',1,'PUBLIC','PROCESSING',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
                owner,fileId,"转码进度越权探针","回归 SEC-01");
        long videoId=jdbc.queryForObject("SELECT MAX(id) FROM videos",Long.class);
        jdbc.update("INSERT INTO transcode_tasks(video_id,quality,status,progress) VALUES(?,?,?,?)",videoId,"720p","QUEUED",5);

        // 1) 匿名访问必须被拒绝，且进度不变
        mvc.perform(get("/api/v1/transcode/"+videoId+"/progress")).andExpect(status().isUnauthorized());
        assertEquals(5,jdbc.queryForObject("SELECT progress FROM transcode_tasks WHERE video_id=?",Integer.class,videoId));

        // 2) 非属主的普通用户必须 403，且进度不变
        mvc.perform(get("/api/v1/transcode/"+videoId+"/progress").header("Authorization","Bearer "+login("newbie")))
                .andExpect(status().isForbidden());
        assertEquals(5,jdbc.queryForObject("SELECT progress FROM transcode_tasks WHERE video_id=?",Integer.class,videoId));

        // 3) 属主可读；重复读取仍不得推进进度
        String token=login("laowang");
        for(int i=0;i<3;i++) {
            mvc.perform(get("/api/v1/transcode/"+videoId+"/progress").header("Authorization","Bearer "+token))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.data.progress").value(5));
        }
        assertEquals(5,jdbc.queryForObject("SELECT progress FROM transcode_tasks WHERE video_id=?",Integer.class,videoId));

        // 4) 管理员（非属主）可读，用于审核场景
        mvc.perform(get("/api/v1/transcode/"+videoId+"/progress").header("Authorization","Bearer "+login("admin")))
                .andExpect(status().isOk());
    }

    /**
     * 回归 SEC-02：登出必须真正吊销 Access Token，即使没有 Redis。
     *
     * <p>此前吊销检查在 Redis 不可用时直接返回「未吊销」（fail-open），登出接口虽然返回
     * 成功，令牌却仍然可用。现在非生产环境有本地降级黑名单，登出后同一令牌立即失效；
     * 生产环境则保持 fail-closed（无法确认吊销状态即拒绝请求）。</p>
     */
    @Test void logoutRevokesTheAccessTokenWithoutRedis() throws Exception {
        String token=login("laowang");
        mvc.perform(get("/api/v1/users/me").header("Authorization","Bearer "+token))
                .andExpect(status().isOk());

        mvc.perform(post("/api/v1/auth/logout").header("Authorization","Bearer "+token)
                        .header("X-Requested-With","XMLHttpRequest"))
                .andExpect(status().isOk());

        // 登出后同一令牌必须被拒绝（修复前此处仍为 200）。
        mvc.perform(get("/api/v1/users/me").header("Authorization","Bearer "+token))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/notifications").header("Authorization","Bearer "+token))
                .andExpect(status().isUnauthorized());

        // 吊销按 jti 生效，不应把该账号后续登录也一并锁死。
        String fresh=login("laowang");
        mvc.perform(get("/api/v1/users/me").header("Authorization","Bearer "+fresh))
                .andExpect(status().isOk());
    }

    /**
     * 回归 SEC-06：MVC 层之外的错误也必须走项目统一响应信封。
     *
     * <p>此前这类错误落到 Spring Boot 默认的 {@code /error}，输出
     * {@code {"timestamp","status","error","path"}} —— 客户端无法用统一信封解析，
     * 而且错误体会回显完整请求路径。</p>
     */
    @Test void fallbackErrorEndpointUsesTheUnifiedEnvelope() throws Exception {
        mvc.perform(get("/error").requestAttr(jakarta.servlet.RequestDispatcher.ERROR_STATUS_CODE, 403))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value(40301))
                .andExpect(jsonPath("$.message").value("没有权限执行此操作"))
                .andExpect(jsonPath("$.timestamp").exists())
                // Spring 默认错误体的字段不得再出现：path 会回显请求路径。
                .andExpect(jsonPath("$.path").doesNotExist())
                .andExpect(jsonPath("$.error").doesNotExist());

        mvc.perform(get("/error").requestAttr(jakarta.servlet.RequestDispatcher.ERROR_STATUS_CODE, 404))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value(40401))
                .andExpect(jsonPath("$.message").value("资源不存在"));
    }

    /**
     * 回归 FUN-03：分页参数的「过大」在各类列表端点上行为一致。
     *
     * <p>此前只有 /videos/recommend 与 /users/search 带 @Max，其余列表端点会把超大 pageSize
     * 静默钳制后返回 200 —— 同类错误给出不同响应。现在统一为：**过大 → 400**。</p>
     *
     * <p>同时固化既有的另一半约定：**过小/零值仍被钳制为 200**，不因这次改动而回归。
     * 该行为由 PlatformIntegrationTest.paginationAndMalformedInputDoNotCauseServerErrors 固化，
     * 语义是「畸形的分页参数不该把请求打成错误」。</p>
     */
    @Test void oversizedPageSizeIsRejectedButUndersizedIsClamped() throws Exception {
        for (String path : List.of("/api/v1/users/3/videos", "/api/v1/users/3/favorites",
                "/api/v1/users/3/followers", "/api/v1/feeds", "/api/v1/videos/1/comments",
                "/api/v1/comments/1/replies")) {
            mvc.perform(get(path).param("pageSize", "99999")).andExpect(status().isBadRequest());
        }

        mvc.perform(get("/api/v1/feeds").param("pageSize", "-5")).andExpect(status().isOk());
        mvc.perform(get("/api/v1/videos/1/comments").param("page", "0").param("pageSize", "-1"))
                .andExpect(status().isOk());
        mvc.perform(get("/api/v1/users/3/videos").param("pageSize", "100000"))
                .andExpect(status().isBadRequest());
    }

    /**
     * 回归 QUA-02：搜索接口的 {@code costMs} 必须是真实耗时，且建议词非空。
     *
     * <p>此前 {@code costMs} 硬编码为 1，而前端搜索页会把它显示成「耗时 1ms」，
     * 等于向用户展示一个假指标。这里只断言契约（存在且 ≥1），不锁定具体数值。</p>
     */
    @Test void searchReportsRealElapsedTimeAndNonEmptySuggestions() throws Exception {
        mvc.perform(get("/api/v1/videos/search").param("q", "光影"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.suggestions").isNotEmpty())
                .andExpect(jsonPath("$.data.costMs").value(org.hamcrest.Matchers.greaterThanOrEqualTo(1)));
    }
}
