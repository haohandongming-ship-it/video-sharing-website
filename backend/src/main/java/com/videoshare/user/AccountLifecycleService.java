package com.videoshare.user;

import com.videoshare.auth.RefreshTokenService;
import com.videoshare.common.ApiException;
import com.videoshare.common.ErrorCode;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AccountLifecycleService {
    private final JdbcTemplate jdbc;
    private final RefreshTokenService refreshTokens;

    public AccountLifecycleService(JdbcTemplate jdbc, RefreshTokenService refreshTokens) {
        this.jdbc = jdbc;
        this.refreshTokens = refreshTokens;
    }

    @Transactional
    public Instant requestDeletion(long userId, String reason) {
        List<Timestamp> existing = jdbc.query(
                "SELECT scheduled_at FROM account_deletion_requests WHERE user_id=? AND status='PENDING' ORDER BY id DESC LIMIT 1",
                (rs, row) -> rs.getTimestamp(1), userId);
        if (!existing.isEmpty()) return existing.get(0).toInstant();
        Instant scheduled = Instant.now().plus(Duration.ofDays(7));
        jdbc.update("INSERT INTO account_deletion_requests(user_id,reason,status,scheduled_at) VALUES(?,?,?,?)",
                userId, reason, "PENDING", Timestamp.from(scheduled));
        jdbc.update("UPDATE users SET status='DEACTIVATED',updated_at=? WHERE id=?", Timestamp.from(Instant.now()), userId);
        refreshTokens.revokeAll(userId);
        return scheduled;
    }

    @Scheduled(cron = "0 15 * * * *")
    @Transactional
    public void anonymizeDueAccounts() {
        List<Map<String, Object>> due = jdbc.queryForList(
                "SELECT id,user_id FROM account_deletion_requests WHERE status='PENDING' AND scheduled_at<=?",
                Timestamp.from(Instant.now()));
        for (Map<String, Object> row : due) {
            long requestId = ((Number) row.get("id")).longValue();
            long userId = ((Number) row.get("user_id")).longValue();
            int updated = jdbc.update(
                    "UPDATE users SET username=?,email=?,phone=NULL,password_hash=?,nickname=?,avatar_url=NULL,bio=NULL,status='DELETED',updated_at=? WHERE id=? AND status='DEACTIVATED'",
                    "deleted_" + userId, "deleted_" + userId + "@anonymous.invalid", "DELETED", "已注销用户", Timestamp.from(Instant.now()), userId);
            if (updated == 0) throw new ApiException(ErrorCode.CONFLICT, "账号注销状态已变化");
            jdbc.update("UPDATE creator_profiles SET real_name_encrypted=NULL,id_card_hash=NULL,auth_status='NONE' WHERE user_id=?", userId);
            jdbc.update("DELETE FROM oauth_accounts WHERE user_id=?", userId);
            jdbc.update("UPDATE account_deletion_requests SET status='COMPLETED',completed_at=? WHERE id=?", Timestamp.from(Instant.now()), requestId);
            refreshTokens.revokeAll(userId);
        }
    }
}
