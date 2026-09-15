package com.videoshare.auth;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.videoshare.common.ApiException;
import com.videoshare.common.ErrorCode;
import jakarta.servlet.http.HttpServletRequest;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.time.Duration;
import java.util.Locale;
import java.util.concurrent.Semaphore;
import java.util.function.Supplier;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

/**
 * 失败预算与 BCrypt 准入控制。
 *
 * <p>按「登录标识」（密码登录用账号，短信登录与重置密码用手机号）和「客户端地址」两个维度计数，
 * 任一维度成功一次即清零。IP 维度只在能确认「一个地址就是一位调用者」时启用：反向代理后面
 * socket 地址是代理自己的地址，若照样按 IP 计数，攻击者制造的失败会把整个部署锁死。
 *
 * <ul>
 *   <li>直连部署：socket 地址是公网地址时按 IP 计数；私网/环回地址说明前面还有本机代理，不按 IP 计数。</li>
 *   <li>反向代理部署：设置 {@code app.auth.trust-proxy-headers=true}，并让代理追加 X-Forwarded-For，
 *       取最右侧一跳（代理亲眼看到的对端）作为客户端地址。</li>
 * </ul>
 */
@Component
public class LoginThrottle {
    private static final int IDENTITY_LIMIT = 5;
    private static final int IP_LIMIT = 50;

    private final Cache<String, Integer> failures = Caffeine.newBuilder()
            .maximumSize(50_000).expireAfterWrite(Duration.ofMinutes(15)).build();
    private final Semaphore permits = new Semaphore(8);
    private final boolean trustProxyHeaders;

    public LoginThrottle(Environment environment) {
        this.trustProxyHeaders = environment.getProperty("app.auth.trust-proxy-headers", Boolean.class, false);
    }

    /** 解析出的客户端地址；{@code perCaller} 为真表示该地址唯一对应一位调用者，可用于 IP 维度计数。 */
    public record ClientAddress(String value, boolean perCaller) { }

    public ClientAddress resolve(HttpServletRequest request) {
        if (trustProxyHeaders) {
            String forwarded = request.getHeader("X-Forwarded-For");
            if (forwarded != null && !forwarded.isBlank()) {
                String[] hops = forwarded.split(",");
                String candidate = hops[hops.length - 1].trim();
                if (isIpLiteral(candidate)) return new ClientAddress(candidate, true);
            }
        }
        String remote = request.getRemoteAddr();
        return new ClientAddress(remote == null || remote.isBlank() ? "unknown" : remote,
                isIpLiteral(remote) && isPublicAddress(remote));
    }

    public <T> T execute(String identity, ClientAddress client, Supplier<T> login) {
        String identityKey = "id:" + identity.trim().toLowerCase(Locale.ROOT);
        String ipKey = "ip:" + client.value();
        if (failures.asMap().getOrDefault(identityKey, 0) >= IDENTITY_LIMIT)
            throw new ApiException(ErrorCode.RATE_LIMITED, "失败次数过多，请 15 分钟后重试");
        if (client.perCaller() && failures.asMap().getOrDefault(ipKey, 0) >= IP_LIMIT)
            throw new ApiException(ErrorCode.RATE_LIMITED, "请求过于频繁，请稍后重试");
        if (!permits.tryAcquire()) throw new ApiException(ErrorCode.RATE_LIMITED, "请求繁忙，请稍后重试");
        try {
            T result = login.get();
            failures.invalidate(identityKey);
            failures.invalidate(ipKey);
            return result;
        } catch (ApiException ex) {
            if (ex.errorCode() == ErrorCode.BAD_CREDENTIALS || ex.errorCode() == ErrorCode.SMS_INVALID) {
                failures.asMap().merge(identityKey, 1, Integer::sum);
                if (client.perCaller()) failures.asMap().merge(ipKey, 1, Integer::sum);
            }
            throw ex;
        } finally {
            permits.release();
        }
    }

    /** 只认字面量地址：避免在校验路径上触发 DNS 解析。 */
    private static boolean isIpLiteral(String value) {
        if (value == null || value.isBlank()) return false;
        return value.indexOf(':') >= 0 || value.matches("\\d{1,3}(\\.\\d{1,3}){3}");
    }

    private static boolean isPublicAddress(String value) {
        if (value == null || value.isBlank()) return false;
        try {
            InetAddress address = InetAddress.getByName(value);
            return !(address.isAnyLocalAddress() || address.isLoopbackAddress() || address.isLinkLocalAddress()
                    || address.isSiteLocalAddress() || address.isMulticastAddress());
        } catch (UnknownHostException ex) {
            return false;
        }
    }
}
