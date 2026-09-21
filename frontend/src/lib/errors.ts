/**
 * 前端内部使用的错误类型。
 *
 * 这些错误用于「流程控制」，不是需要展示给用户的失败信息 —— 定义成具名类型是为了让
 * 全局错误处理能识别并跳过它们，避免同一次操作弹出两条提示。
 */

/**
 * 未登录导致的操作中断。
 *
 * <p>交互类 mutation 在 `onMutate` 里发现未登录时会中断本次操作，并已经弹出过中文提示
 * （「请先登录后再操作」）。此前这里抛的是 `new Error('unauthorized')`，会继续走
 * QueryClient 的全局 `onError`，把英文 `unauthorized` 再弹一次，用户看到一中文一英文两条提示。</p>
 */
export class LoginRequiredError extends Error {
  constructor() {
    super('login-required');
    this.name = 'LoginRequiredError';
  }
}
