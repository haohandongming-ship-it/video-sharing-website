package com.videoshare;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.cookie;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("dev")
// 与 QueryCountGuardTest 使用同一份上下文配置，Spring 测试上下文缓存因此只启动一次。
@Import(CountingDataSourceConfiguration.class)
class PlatformIntegrationTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired org.springframework.jdbc.core.JdbcTemplate jdbc;
    @Autowired jakarta.persistence.EntityManager entityManager;

    @Test
    void lanFrontendCanPassAuthCorsPreflight() throws Exception {
        mvc.perform(options("/api/v1/auth/login")
                        .header("Origin", "http://172.20.10.3:5173")
                        .header("Access-Control-Request-Method", "POST")
                        .header("Access-Control-Request-Headers", "content-type,x-requested-with"))
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin", "http://172.20.10.3:5173"))
                .andExpect(header().string("Access-Control-Allow-Credentials", "true"));

        mvc.perform(post("/api/v1/auth/login")
                        .header("Origin", "http://172.20.10.3:5173")
                        .header("X-Requested-With", "XMLHttpRequest")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"account\":\"laowang\",\"password\":\"123456\",\"grantType\":\"PASSWORD\"}"))
                .andExpect(status().isOk())
                .andExpect(cookie().exists("video_refresh"))
                .andExpect(header().string("Access-Control-Allow-Origin", "http://172.20.10.3:5173"));
    }

    @Test
    @org.springframework.transaction.annotation.Transactional
    void deletedCommentsDisappearAndCannotReceiveLikes() throws Exception {
        String token=login("newbie");
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete("/api/v1/comments/1")
                        .header("Authorization","Bearer "+token).header("X-Requested-With","XMLHttpRequest"))
                .andExpect(status().isOk());
        mvc.perform(post("/api/v1/comments/1/like").header("Authorization","Bearer "+token)
                        .header("X-Requested-With","XMLHttpRequest").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"action\":\"LIKE\"}"))
                .andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/videos/1")).andExpect(jsonPath("$.data.stats.comments").value(0));
    }

    @Test
    void authenticatedModulesReturnSuccessfulEnvelopes() throws Exception {
        String token=login("laowang");
        for(String path:java.util.List.of("/videos/history","/videos/favorites","/videos/playlists",
                "/notifications","/messages/conversations","/messages/conversations/1/messages",
                "/users/3","/users/3/videos","/users/3/feeds")) {
            mvc.perform(get("/api/v1"+path).header("Authorization","Bearer "+token))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0));
        }
        token=login("admin");
        for(String path:java.util.List.of("/admin/overview","/admin/users","/admin/videos","/admin/settings")) {
            mvc.perform(get("/api/v1"+path).header("Authorization","Bearer "+token))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0));
        }
    }

    @Test
    void searchMatchesTagsAndHonorsDurationAndDateFilters() throws Exception {
        mvc.perform(get("/api/v1/videos/search").param("q","React"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.items[0].id").value(1));
        mvc.perform(get("/api/v1/videos/search").param("q","光影").param("duration","long"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.items").isEmpty());
        mvc.perform(get("/api/v1/videos/search").param("q","光影").param("dateRange","day"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.items").isEmpty());
    }

    @Test
    void visitorsCanReportViewsAndReadReplies() throws Exception {
        mvc.perform(post("/api/v1/videos/1/view").header("X-Requested-With", "XMLHttpRequest"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.counted").isBoolean());
        mvc.perform(get("/api/v1/comments/1/replies")).andExpect(status().isOk());
    }

    @Test
    @org.springframework.transaction.annotation.Transactional
    void instantUploadCreatesReviewAndAbortedUploadCannotComplete() throws Exception {
        String token=login("laowang");
        String payload=json.writeValueAsString(java.util.Map.of("fileName","test.mp4","fileSize",20000001,
                "sha256",String.format("%064x",1),"title","秒传回归","categoryId",1,"videoType","LONG"));
        String result=mvc.perform(post("/api/v1/uploads/init").header("Authorization","Bearer "+token)
                        .header("X-Requested-With","XMLHttpRequest").contentType(MediaType.APPLICATION_JSON).content(payload))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.instant").value(true))
                .andReturn().getResponse().getContentAsString();
        long videoId=json.readTree(result).path("data").path("videoId").asLong();
        org.junit.jupiter.api.Assertions.assertEquals(1,jdbc.queryForObject("SELECT COUNT(*) FROM video_reviews WHERE video_id=?",Integer.class,videoId));
        payload=json.writeValueAsString(java.util.Map.of("fileName","test.mp4","fileSize",16,
                "sha256","a".repeat(64),"title","取消回归","categoryId",1));
        result=mvc.perform(post("/api/v1/uploads/init").header("Authorization","Bearer "+token)
                        .header("X-Requested-With","XMLHttpRequest").contentType(MediaType.APPLICATION_JSON).content(payload))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        String uploadId=json.readTree(result).path("data").path("uploadId").asString();
        mvc.perform(post("/api/v1/uploads/"+uploadId+"/abort").header("Authorization","Bearer "+token)
                .header("X-Requested-With","XMLHttpRequest")).andExpect(status().isOk());
        mvc.perform(post("/api/v1/uploads/"+uploadId+"/complete").header("Authorization","Bearer "+token)
                .header("X-Requested-With","XMLHttpRequest").contentType(MediaType.APPLICATION_JSON)
                .content("{\"parts\":[{\"partNumber\":1}]}"))
                .andExpect(status().isConflict());
    }

    @Test
    @org.springframework.transaction.annotation.Transactional
    void privateAndReviewingVideosCannotBePlayedByStrangers() throws Exception {
        jdbc.update("UPDATE videos SET visibility='PRIVATE' WHERE id=1");
        mvc.perform(get("/api/v1/videos/1/play")).andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/videos/1/comments")).andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/videos/11/play")).andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/videos/1/play").header("Authorization", "Bearer " + login("laowang")))
                .andExpect(status().isOk());
        jdbc.update("UPDATE videos SET visibility='UNLISTED' WHERE id=1");
        entityManager.clear();
        mvc.perform(get("/api/v1/videos/1")).andExpect(status().isOk());
        mvc.perform(get("/api/v1/videos/1/play")).andExpect(status().isOk());
    }

    @Test
    void paginationAndMalformedInputDoNotCauseServerErrors() throws Exception {
        mvc.perform(get("/api/v1/feeds").param("cursor", "-1").param("pageSize", "-5"))
                .andExpect(status().isOk());
        mvc.perform(get("/api/v1/videos/shorts").param("cursor", "2147483647"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.items").isEmpty());
        mvc.perform(get("/api/v1/videos/1/comments").param("page", "0").param("pageSize", "-1"))
                .andExpect(status().isOk());
        mvc.perform(get("/api/v1/videos/not-a-number")).andExpect(status().isBadRequest());
    }

    @Test
    @org.springframework.transaction.annotation.Transactional
    void followingFeedAndRepostReturnCorrectContent() throws Exception {
        String token=login("newbie");
        mvc.perform(get("/api/v1/feeds").param("type", "following").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.items.length()").value(1))
                .andExpect(jsonPath("$.data.items[0].user.username").value("laowang"));
        mvc.perform(post("/api/v1/feeds").header("Authorization", "Bearer " + token)
                        .header("X-Requested-With", "XMLHttpRequest").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"content\":\"转发测试\",\"repostOfId\":1}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.repostOf.id").value(1));
        mvc.perform(get("/api/v1/feeds/1")).andExpect(jsonPath("$.data.stats.reposts").value(1));
    }

    @Test
    void cannotFavoriteIntoAnotherUsersFolder() throws Exception {
        mvc.perform(post("/api/v1/videos/1/favorite").header("Authorization", "Bearer " + login("newbie"))
                        .header("X-Requested-With", "XMLHttpRequest").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"action\":\"FAVORITE\",\"folderId\":1}"))
                .andExpect(status().isForbidden());
    }

    @Test
    void publicCatalogMatchesFrontendEnvelope() throws Exception {
        mvc.perform(get("/api/v1/categories"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data[0].id").isNumber());
        mvc.perform(get("/api/v1/videos/recommend").param("page", "1").param("pageSize", "8"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items").isArray())
                .andExpect(jsonPath("$.data.page").value(1));
        mvc.perform(get("/api/v1/videos/1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.author.nickname").isString())
                .andExpect(jsonPath("$.data.stats.views").isNumber());
    }

    @Test
    void passwordLoginIssuesAccessAndRefreshTokens() throws Exception {
        String token = login("laowang");
        mvc.perform(get("/api/v1/users/me").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.username").value("laowang"))
                .andExpect(jsonPath("$.data.permissions").isArray());
    }

    @Test
    @org.springframework.transaction.annotation.Transactional
    void interactionAndAdminAuthorizationWork() throws Exception {
        String userToken = login("laowang");
        mvc.perform(post("/api/v1/videos/1/like")
                        .header("Authorization", "Bearer " + userToken)
                        .header("X-Requested-With", "XMLHttpRequest")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"action\":\"LIKE\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.active").value(true));
        mvc.perform(post("/api/v1/videos/1/comments")
                        .header("Authorization", "Bearer " + userToken)
                        .header("X-Requested-With", "XMLHttpRequest")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"content\":\"集成测试评论\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").isNumber());
        mvc.perform(post("/api/v1/feeds")
                        .header("Authorization", "Bearer " + userToken)
                        .header("X-Requested-With", "XMLHttpRequest")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"content\":\"集成测试动态\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").isNumber());
        mvc.perform(post("/api/v1/reports")
                        .header("Authorization", "Bearer " + userToken)
                        .header("X-Requested-With", "XMLHttpRequest")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"targetType\":\"VIDEO\",\"targetId\":1,\"reason\":\"SPAM\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.reportId").isNumber());
        mvc.perform(get("/api/v1/admin/overview").header("Authorization", "Bearer " + userToken))
                .andExpect(status().isForbidden());

        String adminToken = login("admin");
        mvc.perform(get("/api/v1/admin/overview").header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.users.total").isNumber());
    }

    private String login(String account) throws Exception {
        String response = mvc.perform(post("/api/v1/auth/login")
                        .header("X-Requested-With", "XMLHttpRequest")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"account\":\"" + account + "\",\"password\":\"123456\",\"grantType\":\"PASSWORD\"}"))
                .andExpect(status().isOk())
                .andExpect(cookie().exists("video_refresh"))
                .andExpect(jsonPath("$.data.accessToken").isString())
                .andReturn().getResponse().getContentAsString();
        JsonNode envelope = json.readTree(response);
        return envelope.path("data").path("accessToken").asString();
    }
}
