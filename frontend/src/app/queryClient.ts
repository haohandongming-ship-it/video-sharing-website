import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import { LoginRequiredError } from '@/lib/errors';
import { useUiStore } from '@/stores/uiStore';
import { authBridge } from '@/api/authBridge';

/** 不重试的业务错误：参数错误、鉴权失败、权限不足、资源不存在 */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError) {
    if (error.isUnauthorized || error.isForbidden || error.isNotFound) return false;
    if (error.code === 40001) return false;
  }
  return failureCount < 2;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      retry: shouldRetry,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 0,
      onError: (error) => {
        // 未登录中断：requireLoginToast 已经给过中文提示，这里跳过，避免再弹一条英文错误。
        if (error instanceof LoginRequiredError) return;
        // 网络异常：顶部细条提示 + 自动重试，不打断用户操作（文档 12.2）
        const message = error instanceof Error ? error.message : '操作失败，请稍后重试';
        useUiStore.getState().toast({ title: message, tone: 'error' });
      },
    },
  },
});
authBridge.onClear(() => queryClient.clear());
