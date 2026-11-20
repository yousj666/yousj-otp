/* 生成桌面版(Node crypto)加密的信封给安卓端 JVM 自测解密用 */
'use strict';
const fs = require('fs');
const path = require('path');
const desktop = require('../../desktop/vault.js');

const sample = {
  accounts: [{ id: 'a1', name: 'alice@example.com', issuer: 'GitHub', secret: 'JBSWY3DPEHPK3PXP',
               algorithm: 'SHA1', digits: 6, period: 30, type: 'totp', counter: 0 }],
  diary: [{ id: 'd1', date: '2026-11-20', title: '测试', body: '跨端兼容 ✓', mood: '开心',
            createdAt: 1, updatedAt: 1 }],
  settings: { autoLockMinutes: 5 }
};
const PW = 'correct horse 电池 staple';
const outDir = __dirname;
fs.writeFileSync(path.join(outDir, 'env-from-desktop.json'),
  JSON.stringify(desktop.encryptEnvelope(sample, PW), null, 2));
fs.writeFileSync(path.join(outDir, 'expected-plain.txt'), JSON.stringify(sample));
fs.writeFileSync(path.join(outDir, 'sample.json'), JSON.stringify(sample, null, 2));
console.log('已生成 env-from-desktop.json / expected-plain.txt');
