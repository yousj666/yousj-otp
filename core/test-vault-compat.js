/*
 * 加密备份跨端兼容测试：桌面版(Node crypto) 与插件版(WebCrypto) 必须能互相解密。
 * 运行：node core/test-vault-compat.js
 */
'use strict';
const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const desktop = require('../desktop/vault.js');
const ext = require('../extension/vault.js');

const sample = {
  accounts: [{ id: 'a1', name: 'alice@example.com', issuer: 'GitHub', secret: 'JBSWY3DPEHPK3PXP',
               algorithm: 'SHA1', digits: 6, period: 30, type: 'totp', counter: 0 }],
  diary: [{ id: 'd1', date: '2026-11-20', title: '测试', body: '跨端兼容 ✓', mood: '开心',
            createdAt: 1, updatedAt: 1 }],
  settings: { autoLockMinutes: 5 }
};
const PW = 'correct horse 电池 staple';

(async () => {
  // 1) 桌面加密 → 插件解密
  const envDesktop = desktop.encryptEnvelope(sample, PW);
  const openedByExt = await ext.decryptEnvelope(envDesktop, PW);
  assert.deepStrictEqual(openedByExt, sample);
  console.log('  ✓ 桌面版加密 → 插件版解密');

  // 2) 插件加密 → 桌面解密
  const envExt = await ext.encryptEnvelope(sample, PW);
  const openedByDesktop = desktop.decryptEnvelope(envExt, PW);
  assert.deepStrictEqual(openedByDesktop, sample);
  console.log('  ✓ 插件版加密 → 桌面版解密');

  // 3) 错密码必须失败
  await assert.rejects(() => ext.decryptEnvelope(envDesktop, 'wrong'));
  assert.throws(() => desktop.decryptEnvelope(envExt, 'wrong'));
  console.log('  ✓ 错误密码两端均拒绝');

  // 4) 格式信封字段齐全
  for (const k of ['app', 'version', 'kdf', 'cipher', 'data']) {
    assert.ok(envDesktop[k] && envExt[k], `信封缺字段 ${k}`);
  }
  assert.strictEqual(envDesktop.kdf.iterations, 210000);
  console.log('  ✓ 信封结构与 KDF 参数（PBKDF2 210000 次）一致');

  // 5) VaultStore 落盘全流程：建库 → 锁定 → 解锁 → 改密码
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'otp-vault-')), 'vault.json');
  const store = new desktop.VaultStore(file);
  assert.strictEqual(store.exists(), false);
  store.setup(PW, JSON.parse(JSON.stringify(sample)));
  assert.strictEqual(store.exists(), true);
  store.lock();
  assert.throws(() => store.unlock('wrong'));
  const data = store.unlock(PW);
  assert.deepStrictEqual(data, sample);
  store.changePassword(PW, 'new-password-2');
  store.lock();
  assert.throws(() => store.unlock(PW));
  assert.deepStrictEqual(store.unlock('new-password-2'), sample);
  console.log('  ✓ VaultStore 建库/解锁/改密码全流程');

  console.log('\n跨端兼容全部通过 ✓');
})().catch((e) => { console.error('✗ 失败:', e); process.exit(1); });
