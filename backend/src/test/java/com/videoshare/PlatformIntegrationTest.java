package com.videoshare;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.cookie;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("dev")
class PlatformIntegrationTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;

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
        return envelope.path("data").path("accessToken").asText();
    }
}
