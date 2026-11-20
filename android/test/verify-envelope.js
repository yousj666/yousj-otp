/* 验证安卓端 JVM 自测加密出的信封能被桌面版(Node crypto)解开 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const desktop = require('../../desktop/vault.js');

const sample = JSON.parse(fs.readFileSync(path.join(__dirname, 'sample.json'), 'utf8'));
const env = JSON.parse(fs.readFileSync(path.join(__dirname, 'env-from-android.json'), 'utf8'));
const opened = desktop.decryptEnvelope(env, 'correct horse 电池 staple');
assert.deepStrictEqual(opened, sample);
console.log('  ✓ 安卓端加密 → 桌面版解密，明文一致');
