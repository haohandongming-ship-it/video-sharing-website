import { authBridge } from '@/api/authBridge';
import { SEARCH_HISTORY_KEY } from '@/lib/constants';
import { storage } from '@/lib/storage';
import { usePlayerStore } from '@/stores/playerStore';

/**
 * 登出 / 会话失效时的「设备本地痕迹」清理。
 *
 * <p>播放记忆与搜索历史都按**设备**存储、不带账号维度。若不在会话结束时清掉，
 * 同一台设备换账号后，新用户会看到上一用户的「继续观看」进度与搜索词。</p>
 *
 * <p>挂在 {@link authBridge.onClear} 上，因此登出、刷新令牌失败、会话过期三条路径
 * 都会被覆盖（它们都调用 {@code authBridge.clear()}）。音量、倍速、清晰度等
 * 纯偏好不属于个人痕迹，刻意保留。</p>
 */
export function registerSessionCleanup(): void {
  authBridge.onClear(() => {
    // 清 state 中的 memory，并移除分散落盘的 `vs-progress:<videoId>` 键。
    usePlayerStore.getState().clearMemory();
    storage.remove(SEARCH_HISTORY_KEY);
  });
}
