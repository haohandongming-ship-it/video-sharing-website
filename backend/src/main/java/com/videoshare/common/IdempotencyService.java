package com.videoshare.common;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

/**
 * 幂等执行器。
 *
 * <p>沿用「先占位、后回填」的乐观插入策略：唯一键冲突即视为重复请求。Jackson 3 的
 * {@code readValue/writeValueAsString} 不再抛出受检异常，重放路径因此收敛成一个方法。</p>
 */
@Service
public class IdempotencyService {

    private static final Duration RETENTION = Duration.ofHours(24);
    private static final int MAX_KEY_LENGTH = 80;

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    public IdempotencyService(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    @Transactional
    public Map<String, Object> execute(long userId, String scope, String key, Supplier<Map<String, Object>> operation) {
        if (key == null || key.isBlank()) return operation.get();
        if (key.length() > MAX_KEY_LENGTH) throw new ApiException(ErrorCode.VALIDATION, "Idempotency-Key 过长");
        Instant now = Instant.now();
        try {
            jdbc.update("INSERT INTO idempotency_records(idempotency_key,request_scope,user_id,expires_at) VALUES(?,?,?,?)",
                    key, scope, userId, Timestamp.from(now.plus(RETENTION)));
        } catch (DuplicateKeyException duplicate) {
            return replay(userId, scope, key, now);
        }
        Map<String, Object> result = operation.get();
        jdbc.update("""
                UPDATE idempotency_records SET response_code=0,response_body=?
                WHERE idempotency_key=? AND request_scope=? AND user_id=?""",
                json.writeValueAsString(result), key, scope, userId);
        return result;
    }

    private Map<String, Object> replay(long userId, String scope, String key, Instant now) {
        List<String> cached = jdbc.query("""
                SELECT response_body FROM idempotency_records
                WHERE idempotency_key=? AND request_scope=? AND user_id=? AND expires_at>?""",
                (rs, row) -> rs.getString(1), key, scope, userId, Timestamp.from(now));
        String body = cached.isEmpty() ? null : cached.getFirst();
        if (body == null) throw new ApiException(ErrorCode.CONFLICT, "相同请求正在处理中");
        try {
            Map<String, Object> parsed = json.readValue(body, new TypeReference<Map<String, Object>>() { });
            return parsed == null ? Map.of() : parsed;
        } catch (RuntimeException ex) {
            throw new ApiException(ErrorCode.INTERNAL, "幂等响应读取失败");
        }
    }

    @Scheduled(cron = "0 30 * * * *")
    public void cleanup() {
        jdbc.update("DELETE FROM idempotency_records WHERE expires_at<?", Timestamp.from(Instant.now()));
    }
}
