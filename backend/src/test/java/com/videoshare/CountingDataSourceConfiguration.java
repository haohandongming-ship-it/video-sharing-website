package com.videoshare;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.jdbc.datasource.DelegatingDataSource;

/**
 * 统计 JDBC 语句次数的测试基础设施。
 *
 * <p>作为顶层 {@code @TestConfiguration} 被两个测试类共同导入，这样 Spring 测试框架
 * 的上下文缓存只创建一个 ApplicationContext：既省去重复启动，也避免每个上下文各建一个
 * Lettuce 客户端、在关闭时互相干扰 JVM 级的 Netty 事件执行器。</p>
 */
@TestConfiguration
class CountingDataSourceConfiguration {

    @Bean
    static BeanPostProcessor countingDataSourcePostProcessor() {
        return new BeanPostProcessor() {
            @Override
            public Object postProcessAfterInitialization(Object bean, String beanName) {
                return bean instanceof DataSource dataSource && !(bean instanceof CountingDataSource)
                        ? new CountingDataSource(dataSource)
                        : bean;
            }
        };
    }

    /** 统计 prepareStatement/createStatement 次数；其余调用原样透传。 */
    static class CountingDataSource extends DelegatingDataSource {
        private static final AtomicInteger STATEMENTS = new AtomicInteger();

        CountingDataSource(DataSource delegate) {
            super(delegate);
        }

        static void reset() {
            STATEMENTS.set(0);
        }

        static int count() {
            return STATEMENTS.get();
        }

        @Override
        public Connection getConnection() throws SQLException {
            return wrap(super.getConnection());
        }

        @Override
        public Connection getConnection(String username, String password) throws SQLException {
            return wrap(super.getConnection(username, password));
        }

        private static Connection wrap(Connection connection) {
            return (Connection) Proxy.newProxyInstance(CountingDataSource.class.getClassLoader(),
                    new Class<?>[]{Connection.class}, (proxy, method, args) -> {
                        if (method.getName().startsWith("prepareStatement") || "createStatement".equals(method.getName())) {
                            STATEMENTS.incrementAndGet();
                        }
                        try {
                            return method.invoke(connection, args);
                        } catch (InvocationTargetException ex) {
                            throw ex.getCause();
                        }
                    });
        }
    }
}
