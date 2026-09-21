/**
 * localStorage 只允许存放主题、音量、UI 偏好等非敏感数据（文档 5.1 安全说明）。
 * Token 一律仅存内存，禁止写入任何持久化存储。
 */
const PREFIX = 'vs-';

export type StorageKind = 'local' | 'session';

function getBackend(kind: StorageKind): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export const storage = {
  get<T>(key: string, fallback: T, kind: StorageKind = 'local'): T {
    const backend = getBackend(kind);
    if (!backend) return fallback;
    try {
      const raw = backend.getItem(PREFIX + key);
      if (raw === null) return fallback;
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  },
  set<T>(key: string, value: T, kind: StorageKind = 'local'): void {
    const backend = getBackend(kind);
    if (!backend) return;
    try {
      backend.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      /* 隐私模式或超配额时静默降级 */
    }
  },
  remove(key: string, kind: StorageKind = 'local'): void {
    getBackend(kind)?.removeItem(PREFIX + key);
  },
  /**
   * 移除所有以 `prefix` 开头的键。
   *
   * <p>用于清理「按 id 分散写入」的数据，例如播放记忆的 `progress:<videoId>`：
   * 这类键数量随观看过的视频增长，无法靠单个 `remove` 清干净，登出时若不处理
   * 会把上一用户的观看痕迹留在设备上。</p>
   */
  removeByPrefix(prefix: string, kind: StorageKind = 'local'): void {
    const backend = getBackend(kind);
    if (!backend) return;
    const full = PREFIX + prefix;
    // 先收集再删除：边遍历边 removeItem 会因索引位移而漏掉键。
    const doomed: string[] = [];
    try {
      for (let i = 0; i < backend.length; i++) {
        const key = backend.key(i);
        if (key !== null && key.startsWith(full)) doomed.push(key);
      }
      for (const key of doomed) backend.removeItem(key);
    } catch {
      /* 隐私模式或超配额时静默降级 */
    }
  },
};

interface PersistStateStorage {
  getItem: (name: string) => string | null;
  setItem: (name: string, value: string) => void;
  removeItem: (name: string) => void;
}

const memoryFallback = new Map<string, string>();

/**
 * zustand/persist 使用的存储后端（StateStorage 形态）。
 * localStorage 不可用（隐私模式/SSR）时降级为内存 Map，保证读写不抛错。
 */
export function getPersistBackend(kind: StorageKind = 'local'): PersistStateStorage {
  return {
    getItem: (name) => {
      const backend = getBackend(kind);
      if (backend) {
        try {
          return backend.getItem(name);
        } catch {
          return memoryFallback.get(`${kind}:${name}`) ?? null;
        }
      }
      return memoryFallback.get(`${kind}:${name}`) ?? null;
    },
    setItem: (name, value) => {
      const backend = getBackend(kind);
      memoryFallback.set(`${kind}:${name}`, value);
      try {
        backend?.setItem(name, value);
      } catch {
        /* 超配额/隐私模式：保留内存副本 */
      }
    },
    removeItem: (name) => {
      memoryFallback.delete(`${kind}:${name}`);
      try {
        getBackend(kind)?.removeItem(name);
      } catch {
        /* ignore */
      }
    },
  };
}
