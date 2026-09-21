/**
 * 演示账号：**仅**在 Mock 数据层开启（`VITE_USE_MOCK=true`）时可用。
 *
 * 这些口令是公开的弱口令，绝不能出现在生产产物里。因此本模块放在 `mocks/` 下，
 * 且只被 `USE_MOCK &&` 分支引用 —— `USE_MOCK` 由 Vite 在构建期替换为字面量，
 * Rollup 随即折叠该分支，本模块因不再被引用而被整体剔除。
 *
 * 修改本文件后请运行 `node scripts/verify-no-demo-accounts.mjs` 复核生产产物中
 * 不含演示账号（见 package.json 的 `verify:secrets` 脚本）。
 */
export interface DemoAccount {
  account: string;
  password: string;
  label: string;
  hint: string;
}

export const DEMO_ACCOUNTS: DemoAccount[] = [
  { account: 'admin', password: '123456', label: '管理员', hint: '审核与用户管理' },
  { account: 'moderator', password: '123456', label: '审核员', hint: '审核队列与举报' },
  { account: 'laowang', password: '123456', label: '创作者', hint: '上传与数据看板' },
  { account: 'newbie', password: '123456', label: '新用户', hint: '先审后发策略' },
];
