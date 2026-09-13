import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => cleanup());

// jsdom 未实现 matchMedia / IntersectionObserver / ResizeObserver，测试环境补齐
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
});

class MockObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
vi.stubGlobal('IntersectionObserver', MockObserver);
vi.stubGlobal('ResizeObserver', MockObserver);

/**
 * 部分 jsdom 版本不向全局暴露 localStorage（仅挂在 window 上），
 * 而应用代码通过 globalThis 访问。这里补齐一个符合 Storage 契约的实现，
 * 保证「偏好持久化」相关逻辑可在测试中被真实验证。
 */
function createMockStorage(): Storage {
  const area = new Map<string, string>();
  const storage = {
    get length() {
      return area.size;
    },
    key: (index: number) => [...area.keys()][index] ?? null,
    getItem: (key: string) => (area.has(key) ? (area.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      area.set(String(key), String(value));
    },
    removeItem: (key: string) => {
      area.delete(key);
    },
    clear: () => area.clear(),
  };
  return storage as Storage;
}

if (typeof globalThis.localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', { writable: true, value: createMockStorage() });
}
if (typeof globalThis.sessionStorage === 'undefined') {
  Object.defineProperty(globalThis, 'sessionStorage', { writable: true, value: createMockStorage() });
}
