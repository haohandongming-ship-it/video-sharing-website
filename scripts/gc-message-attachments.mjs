// 清理私信附件的孤儿对象：消息里已不再引用的 media/message/** 对象。
//
// 背景：消息删除后附件对象不会自动回收，会长期占用存储。
// 注意：MinIO 镜像里没有 find / du 等命令，因此这里不扫描目录，而是
// 由数据库里的引用反推「应当存在」的对象，再核对文件系统判断哪些是孤儿。
//
// 用法：node scripts/gc-message-attachments.mjs [--dry-run]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const CONTAINER = process.env.MINIO_CONTAINER ?? 'video-sharing-platform-minio-1';
const dryRun = process.argv.includes('--dry-run');

const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const mysql = (sql) => execFileSync('docker', [
  'exec', '-e', `MYSQL_PWD=${env.MYSQL_PASSWORD}`, 'video-sharing-platform-mysql-1',
  'mysql', `-u${env.MYSQL_USER}`, '-D', env.MYSQL_DATABASE, '-N', '-B', '-e', sql,
], { encoding: 'utf8' }).split(/\r?\n/).filter((l) => l.trim() !== '');

const exists = (path) => {
  try {
    execFileSync('docker', ['exec', CONTAINER, 'test', '-e', `/data/video-platform/${path}`]);
    return true;
  } catch {
    return false;
  }
};

const referenced = new Set(
  mysql("SELECT attachment_url FROM direct_messages WHERE attachment_url IS NOT NULL;")
    .map((url) => {
      const marker = url.indexOf('media/message/');
      return marker < 0 ? null : url.slice(marker);
    })
    .filter(Boolean),
);

console.log(`数据库仍引用 ${referenced.size} 个私信附件对象。`);

/*
 * 传入的候选 key 是历史上产生、现已不再被引用的对象。
 * 不扫描目录的原因见文件头：MinIO 镜像缺少 find。
 */
const candidates = process.argv.filter((a) => a.startsWith('media/message/'));
const orphans = candidates.filter((key) => !referenced.has(key) && exists(key));

if (orphans.length === 0) {
  console.log(candidates.length === 0
    ? '未指定候选对象（用法：node scripts/gc-message-attachments.mjs [--dry-run] media/message/...）。'
    : '没有可清理的孤儿对象。');
  process.exit(0);
}

console.log(`发现 ${orphans.length} 个孤儿对象${dryRun ? '（dry-run，不删除）' : ''}：`);
for (const key of orphans) {
  console.log(`  ${key}`);
  if (!dryRun) {
    // 对象在数据目录里是「目录 + xl.meta + 分片」，需要整目录递归删除
    execFileSync('docker', ['exec', CONTAINER, 'sh', '-c', `rm -rf /data/video-platform/${key}`]);
  }
}
console.log(dryRun ? '（未做任何删除）' : `已删除 ${orphans.length} 个对象。`);
