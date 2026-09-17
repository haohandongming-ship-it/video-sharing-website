// 隐藏开发种子生成的占位视频，让首页只出现真实上传的内容。
//
// 背景：DevDataSeeder 会插入 4 条「光影视频示例」，它们的源文件是占位记录，
// 再由 DevMediaRepair 用打包的合成演示片（纯色 + 时间码水印）替换，因此画面上
// 没有任何真实内容。这些记录是测试基座（多个集成测试直接访问 /videos/1、/videos/3），
// 所以不能删除，只能置为非公开——公开列表的过滤条件是
// `v.status='PUBLISHED' AND v.visibility='PUBLIC'`。
//
// 用法（仓库根目录）：
//   node scripts/hide-seed-demo-videos.mjs            # 隐藏
//   node scripts/hide-seed-demo-videos.mjs --restore  # 恢复公开
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = process.cwd();
const CONTAINER = process.env.MYSQL_CONTAINER ?? 'video-sharing-platform-mysql-1';
const restore = process.argv.includes('--restore');

const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
    .map((line) => {
      const idx = line.indexOf('=');
      return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
    }),
);

const query = (sql) => execFileSync('docker', [
  'exec', '-e', `MYSQL_PWD=${env.MYSQL_PASSWORD}`, CONTAINER,
  'mysql', `-u${env.MYSQL_USER}`, '-D', env.MYSQL_DATABASE, '--default-character-set=utf8mb4', '-N', '-B', '-e', sql,
], { encoding: 'utf8' });

/**
 * 判定种子占位视频的两个特征（取并集，避免依赖单一标记）：
 *  1. DevDataSeeder 插入的占位文件行：sha256 为全零、object_key 形如 demo/N.mp4；
 *     这些行在 DevMediaRepair 把视频改指向真实样片后依然留在 files 表里。
 *  2. 种子标题本身就是「光影视频示例 N」，即使占位行被清理也能识别。
 */
const SEED_VIDEO_FILTER = `
  v.title LIKE '光影视频示例 %'
  OR v.id IN (SELECT v2.id FROM videos v2 JOIN files f2 ON f2.id = v2.source_file_id
              WHERE f2.object_key LIKE 'demo/%')
`;

const targets = query(
  `SELECT id FROM videos v WHERE (${SEED_VIDEO_FILTER}) ORDER BY id;`,
).split(/\r?\n/).filter(Boolean);

if (targets.length === 0) {
  console.log('没有找到种子占位视频（可能已被清理）。');
  process.exit(0);
}

const visibility = restore ? 'PUBLIC' : 'PRIVATE';
query(`UPDATE videos SET visibility='${visibility}' WHERE id IN (${targets.join(',')});`);

console.log(`${restore ? '已恢复公开' : '已隐藏'} ${targets.length} 条种子占位视频：id=${targets.join(',')}`);
console.log(`visibility = ${visibility}`);
console.log('\n当前公开可见的视频：');
console.log(query(
  "SELECT id, title FROM videos WHERE status='PUBLISHED' AND visibility='PUBLIC' ORDER BY id;",
).trim() || '(无)');
