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

    /**
     * 统计 prepareStatement/createStatement 次数；其余调用原样透传。
     *
     * <p><b>只统计「发起测量的那个线程」的语句。</b> 计数器原先是不区分线程的全局值，
     * 而 {@code TranscodeWorker} 是 {@code @Scheduled(fixedDelay = 1s)} 的后台线程，
     * 它每个 tick 都会 prepareStatement（有 RUNNING 任务时还有若干 UPDATE/INSERT）。
     * 一旦它的 tick 落在测量窗口内，{@code QueryCountGuardTest} 的「SQL 条数不随页大小
     * 增长」断言就会随机失败。按线程过滤后，后台线程的语句不再计入，护栏结果稳定可复现。</p>
     */
    static class CountingDataSource extends DelegatingDataSource {
        private static final AtomicInteger STATEMENTS = new AtomicInteger();

        /** 发起测量的线程；仅该线程的语句计入。 */
        private static volatile Thread measuredThread;

        CountingDataSource(DataSource delegate) {
            super(delegate);
        }

        static void reset() {
            measuredThread = Thread.currentThread();
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
                        if (Thread.currentThread() == measuredThread
                                && (method.getName().startsWith("prepareStatement") || "createStatement".equals(method.getName()))) {
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
