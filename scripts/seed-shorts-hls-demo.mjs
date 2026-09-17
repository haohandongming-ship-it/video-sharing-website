// 插入一条 SHORT 类型的演示视频，并指向随包的多码率 HLS，用于验证短视频的清晰度切换。
// 与 DevDataSeeder 采用相同的插入方式，只是类型为 SHORT。
//
//   node scripts/seed-shorts-hls-demo.mjs [--remove]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const CONTAINER = process.env.MYSQL_CONTAINER ?? 'video-sharing-platform-mysql-1';
const TITLE = '短视频清晰度演示';
const remove = process.argv.includes('--remove');

const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const mysql = (sql) => execFileSync('docker', [
  'exec', '-e', `MYSQL_PWD=${env.MYSQL_PASSWORD}`, CONTAINER,
  'mysql', `-u${env.MYSQL_USER}`, '-D', env.MYSQL_DATABASE, '--default-character-set=utf8mb4', '-N', '-B', '-e', sql,
], { encoding: 'utf8' });

if (remove) {
  mysql(`DELETE FROM videos WHERE title='${TITLE}';`);
  console.log('已移除演示短视频。');
  process.exit(0);
}

const existing = mysql(`SELECT id FROM videos WHERE title='${TITLE}';`).trim();
if (existing) {
  mysql(`UPDATE videos SET hls_url='/api/v1/demo/hls/master.m3u8', status='PUBLISHED', video_type='SHORT' WHERE id=${existing};`);
  console.log(`演示短视频已存在（id=${existing}），已确保指向多码率 HLS。`);
  process.exit(0);
}

// 复用种子里的占位文件行（object_key 形如 demo/N.mp4），repair 会把它替换为真实样片
const fileId = mysql("SELECT id FROM files WHERE object_key='demo/1.mp4' LIMIT 1;").trim() || '1';
mysql(`
  INSERT INTO videos(user_id,source_file_id,title,description,cover_url,hls_url,duration,file_size,
                     video_type,category_id,visibility,status,download_enabled,
                     view_count,like_count,comment_count,favorite_count,
                     published_at,created_at,updated_at)
  VALUES(3,${fileId},'${TITLE}','用于验证短视频清晰度切换的演示内容。',
         'https://picsum.photos/seed/shortshls/640/360','/api/v1/demo/hls/master.m3u8',
         15,20000001,'SHORT',1,'PUBLIC','PUBLISHED',true,
         0,0,0,0,NOW(),NOW(),NOW());`);
const id = mysql(`SELECT id FROM videos WHERE title='${TITLE}';`).trim();
console.log(`已插入演示短视频：id=${id}，hls_url=/api/v1/demo/hls/master.m3u8`);
