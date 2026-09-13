package com.videoshare.common;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
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

@Service
public class IdempotencyService {
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    public IdempotencyService(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    @Transactional
    public Map<String, Object> execute(long userId, String scope, String key, Supplier<Map<String, Object>> operation) {
        if (key == null || key.isBlank()) return operation.get();
        if (key.length() > 80) throw new ApiException(ErrorCode.VALIDATION, "Idempotency-Key 过长");
        try {
            jdbc.update("INSERT INTO idempotency_records(idempotency_key,request_scope,user_id,expires_at) VALUES(?,?,?,?)",
                    key, scope, userId, Timestamp.from(Instant.now().plus(Duration.ofHours(24))));
        } catch (DuplicateKeyException duplicate) {
            List<String> cached = jdbc.query(
                    "SELECT response_body FROM idempotency_records WHERE idempotency_key=? AND request_scope=? AND user_id=? AND expires_at>?",
                    (rs, row) -> rs.getString(1), key, scope, userId, Timestamp.from(Instant.now()));
            if (cached.isEmpty() || cached.get(0) == null) throw new ApiException(ErrorCode.CONFLICT, "相同请求正在处理中");
            try { return json.readValue(cached.get(0), new TypeReference<>() { }); }
            catch (Exception ex) { throw new ApiException(ErrorCode.INTERNAL, "幂等响应读取失败"); }
        }
        Map<String, Object> result = operation.get();
        try {
            jdbc.update("UPDATE idempotency_records SET response_code=0,response_body=? WHERE idempotency_key=? AND request_scope=? AND user_id=?",
                    json.writeValueAsString(result), key, scope, userId);
        } catch (Exception ex) {
            throw new ApiException(ErrorCode.INTERNAL, "幂等响应保存失败");
        }
        return result;
    }

    @Scheduled(cron = "0 30 * * * *")
    public void cleanup() {
        jdbc.update("DELETE FROM idempotency_records WHERE expires_at<?", Timestamp.from(Instant.now()));
    }
}
