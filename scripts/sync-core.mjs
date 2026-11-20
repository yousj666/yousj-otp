/*
 * 把 core/otp-core.js 同步到桌面版与插件版的打包位置。
 * core 是唯一源头，两处副本均为生成物（已 .gitignore），打包/发布前运行。
 * 用法：node scripts/sync-core.mjs
 */
import { copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'core', 'otp-core.js');
const targets = [
  join(root, 'desktop', 'core.js'),
  join(root, 'extension', 'otp-core.js')
];
for (const t of targets) {
  copyFileSync(src, t);
  console.log('synced ->', t);
}
