import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const proxyTarget = env.VITE_PROXY_TARGET || 'http://localhost:8080';
  /**
   * Mock 模式（VITE_USE_MOCK=true）下不启用 /api 代理：
   * 请求由 src/mocks 在浏览器端拦截，若仍配置代理会被 dev server 抢先转发到未启动的后端，导致 500。
   */
  const useMock = env.VITE_USE_MOCK === 'true' || (env.VITE_USE_MOCK !== 'false' && mode === 'development');

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      port: 5173,
      host: true,
      proxy: useMock
        ? undefined
        : {
            '/api': { target: proxyTarget, changeOrigin: true },
            '/ws': { target: proxyTarget, changeOrigin: true, ws: true },
          },
    },
    build: {
      target: 'es2022',
      cssCodeSplit: true,
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            query: ['@tanstack/react-query', '@tanstack/react-virtual'],
            motion: ['framer-motion'],
            media: ['hls.js'],
            realtime: ['@stomp/stompjs'],
          },
        },
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./vitest.setup.ts'],
      css: false,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html'],
        /**
         * 覆盖率口径说明：
         * - 统计范围覆盖核心逻辑（api / lib / stores / hooks）与可复用组件；
         * - 页面级容器组件（src/pages/**）、多端布局壳与重型媒体组件不纳入单元覆盖率门槛，
         *   它们由 scripts/cdp-check.mjs 在真实浏览器中按路由与交互逐项验收（文档 19.4 体验验收）。
         */
        include: ['src/**/*.{ts,tsx}'],
        exclude: [
          'src/**/*.d.ts',
          'src/**/__tests__/**',
          'src/mocks/**',
          'src/main.tsx',
          'src/pages/**',
          'src/app/routes.tsx',
          'src/components/layout/**',
          'src/components/video/VideoPlayer.tsx',
          'src/components/video/useHlsPlayer.ts',
          'src/components/comment/CommentSection.tsx',
          'src/components/video/ShareDialog.tsx',
          'src/components/video/ReportDialog.tsx',
        ],
        thresholds: { lines: 60, functions: 55, statements: 60, branches: 55 },
      },
    },
  };
});
