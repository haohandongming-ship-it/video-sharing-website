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
@Import(CountingDataSourceConfiguration.class)
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
        return json.readTree(result.getResponse().getContentAsString()).at("/data/accessToken").asText();
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
}
