package com.videoshare.config;

import java.util.Arrays;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

/**
 * 非生产 profile 启动提示。
 *
 * <p>把「当前跑的不是生产配置」显式说出来，避免配置漂移被静默接受。此前 {@code dev} 是
 * 默认 profile，忘记设置 profile 的部署会一路跑在开发配置上（固定短信验证码、Swagger、
 * H2 文件库等），却没有任何提示。现在默认 profile 已改为 {@code prod}，本提示作为第二道
 * 保险：只要最终生效的 profile 不是 prod，启动日志里就会出现醒目横幅。</p>
 */
@Component
public class NonProductionProfileNotice implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(NonProductionProfileNotice.class);

    private final Environment environment;

    public NonProductionProfileNotice(Environment environment) {
        this.environment = environment;
    }

    @Override
    public void run(ApplicationArguments args) {
        // matchesProfiles 会同时考虑显式激活的 profile 与 spring.profiles.default，
        // 因此「未设置任何 profile 且 default=prod」会被正确判定为生产环境。
        if (environment.matchesProfiles("prod")) return;
        log.warn("""

                ======================================================================
                 当前以【非生产】profile 启动：{}
                 开发便利项可能处于启用状态：固定短信验证码、Swagger 文档、H2 文件库等。
                 若这是对外可达的环境，请设置 SPRING_PROFILES_ACTIVE=prod 后重启。
                ======================================================================""",
                Arrays.toString(environment.getActiveProfiles()));
    }
}
