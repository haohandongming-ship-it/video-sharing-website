#!/usr/bin/env node
/**
 * 生产产物弱口令回归门禁。
 *
 * 背景：登录页曾**无条件**渲染「演示账号快捷登录」面板，把 admin / moderator /
 * laowang / newbie + 统一口令 123456 带到线上构建，访客可直接点击尝试登录真实后端。
 * 修复后该面板由 `USE_MOCK` 守卫，构建期即被 Rollup 折叠剔除。
 *
 * 本脚本扫描 `vite build` 产物，断言其中不含演示账号标识。发现即退出码 1，
 * 用于在 CI / `pnpm verify` 中防止该问题回归。
 *
 * 用法：
 *   node scripts/verify-no-demo-accounts.mjs [产物目录，默认 dist]
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const distDir = process.argv[2] ?? 'dist';

/**
 * 只在生产产物中「本不该出现」的演示凭据与入口文案。
 *
 * 刻意不检查裸的 `admin`：管理后台页面本身就会用到这个词，会产生大量误报。
 * 也刻意不检查 `laowang` / `newbie`：这两个用户名同样出现在 `src/mocks/seed.ts`
 * 的种子用户里，而 mocks 数据块目前仍会被打进产物（见 COMPREHENSIVE_AUDIT_REPORT.md
 * 的 PERF-02 相关跟进项），断言它们会产生误报。它们不是凭据，不构成本门禁的目标。
 */
const FORBIDDEN = [
  { marker: '演示账号快捷登录', why: '演示账号面板文案' },
  { marker: '以演示账号', why: '演示账号按钮的 aria-label' },
  { marker: '123456', why: '演示账号统一弱口令' },
];

/** 需要扫描的产物类型。 */
const SCANNED_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.css', '.html', '.json']);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SCANNED_EXTENSIONS.has(extname(entry))) out.push(full);
  }
  return out;
}

if (!existsSync(distDir)) {
  console.error(`[verify-no-demo-accounts] 产物目录不存在：${distDir}（请先执行 vite build）`);
  process.exit(2);
}

const files = walk(distDir);
const hits = [];

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const { marker, why } of FORBIDDEN) {
    if (text.includes(marker)) hits.push({ file, marker, why });
  }
}

if (hits.length > 0) {
  console.error('[verify-no-demo-accounts] 失败：生产产物中发现演示账号标识');
  for (const { file, marker, why } of hits) {
    console.error(`  - ${file}  含「${marker}」（${why}）`);
  }
  console.error('\n请确认演示账号相关代码被 `USE_MOCK &&` 守卫，且 mocks 目录未被打进产物。');
  process.exit(1);
}

console.log(
  `[verify-no-demo-accounts] 通过：已扫描 ${files.length} 个产物文件，未发现演示账号标识。`,
);
