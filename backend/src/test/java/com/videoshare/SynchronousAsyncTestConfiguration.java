package com.videoshare;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.core.task.AsyncTaskExecutor;
import org.springframework.core.task.SyncTaskExecutor;
import org.springframework.core.task.support.TaskExecutorAdapter;

/**
 * 让测试上下文里的异步任务在**调用线程**上同步执行。
 *
 * <p><b>为什么需要它</b>：{@code GET /api/v1/videos/{id}/source} 返回
 * {@code StreamingResponseBody}，响应正文由配置的异步执行器在**另一个线程**上写出。
 * 而 MockMvc 的 {@code MockHttpServletResponse} 用非线程安全的
 * {@code LinkedCaseInsensitiveMap}（底层 {@code HashMap}）保存响应头 —— 异步线程写头与
 * 测试线程读取并发时会在 {@code HashMap.computeIfAbsent} 里抛
 * {@code ConcurrentModificationException}，表现为 {@code ReportRegressionTest} 的区间请求
 * 用例偶发失败（实测约 6 次全量运行命中 1 次）。真实 Servlet 容器不存在该问题。</p>
 *
 * <p>把执行器换成同步实现后，正文在请求线程上写完，MockMvc 的响应对象不再被并发访问，
 * 该用例的失败概率归零，整套测试也不再受异步调度时序影响 —— 这是接入 CI 的前提。</p>
 *
 * <p>由四个测试类共同导入（与 {@link CountingDataSourceConfiguration} 一起），
 * 因此 Spring 测试上下文缓存仍只创建一个 ApplicationContext。</p>
 */
@TestConfiguration
class SynchronousAsyncTestConfiguration {

    @Bean
    AsyncTaskExecutor applicationTaskExecutor() {
        // SyncTaskExecutor 在调用线程上直接 run()；TaskExecutorAdapter 把它适配成
        // AsyncTaskExecutor（submit 返回已完成的 Future），供 Spring 的异步处理使用。
        return new TaskExecutorAdapter(new SyncTaskExecutor());
    }
}
