/*
 * 桌面版加密库（Node crypto 实现）
 * 格式与插件版（WebCrypto）严格一致，参数取自 core 的 VAULT_PARAMS：
 * PBKDF2-HMAC-SHA256 210000 次派生 32 字节密钥，AES-256-GCM 加密整个库 JSON。
 * 密文 base64 内容为 ciphertext || tag(16B)，与 WebCrypto 的输出布局一致。
 */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let PARAMS;
try { PARAMS = require('./core.js').VAULT_PARAMS; }
catch (e) { PARAMS = require('../core/otp-core.js').VAULT_PARAMS; }

function deriveKey(password, salt) {
  return crypto.pbkdf2Sync(Buffer.from(String(password), 'utf8'), salt,
    PARAMS.kdf.iterations, PARAMS.keyBytes, 'sha256');
}

function encryptEnvelopeWithKey(key, salt, dataObj) {
  const iv = crypto.randomBytes(PARAMS.cipher.ivBytes);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plain = Buffer.from(JSON.stringify(dataObj), 'utf8');
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    app: PARAMS.app,
    version: PARAMS.formatVersion,
    kdf: {
      name: PARAMS.kdf.name, hash: PARAMS.kdf.hash,
      iterations: PARAMS.kdf.iterations, salt: salt.toString('base64')
    },
    cipher: { name: 'AES-GCM', iv: iv.toString('base64') },
    data: Buffer.concat([ct, tag]).toString('base64')
  };
}

function decryptEnvelopeWithKey(key, envelope) {
  const raw = Buffer.from(envelope.data, 'base64');
  const tag = raw.subarray(raw.length - PARAMS.cipher.tagBytes);
  const ct = raw.subarray(0, raw.length - PARAMS.cipher.tagBytes);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key,
    Buffer.from(envelope.cipher.iv, 'base64'));
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
  return JSON.parse(plain.toString('utf8'));
}

// 静态：用口令解密任意信封（导入备份用）
function decryptEnvelope(envelope, password) {
  if (!envelope || envelope.app !== PARAMS.app || !envelope.kdf || !envelope.cipher) {
    throw new Error('不是有效的 Yousj OTP 备份文件');
  }
  const salt = Buffer.from(envelope.kdf.salt, 'base64');
  const key = crypto.pbkdf2Sync(Buffer.from(String(password), 'utf8'), salt,
    envelope.kdf.iterations || PARAMS.kdf.iterations, PARAMS.keyBytes, 'sha256');
  return decryptEnvelopeWithKey(key, envelope);
}

// 静态：用口令加密成独立信封（导出备份用，全新盐）
function encryptEnvelope(dataObj, password) {
  const salt = crypto.randomBytes(PARAMS.kdf.saltBytes);
  return encryptEnvelopeWithKey(deriveKey(password, salt), salt, dataObj);
}

class VaultStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.key = null;      // 解锁后持有的派生密钥（Buffer）
    this.salt = null;     // 当前盐
    this.data = null;     // 解锁后的明文库对象
  }

  exists() { return fs.existsSync(this.filePath); }
  isUnlocked() { return !!(this.key && this.data); }

  readEnvelope() {
    return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
  }

  writeEnvelope(envelope) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(envelope, null, 2), 'utf8');
  }

  setup(password, initialData) {
    this.salt = crypto.randomBytes(PARAMS.kdf.saltBytes);
    this.key = deriveKey(password, this.salt);
    this.data = initialData;
    this.save();
  }

  unlock(password) {
    const envelope = this.readEnvelope();
    const salt = Buffer.from(envelope.kdf.salt, 'base64');
    const key = crypto.pbkdf2Sync(Buffer.from(String(password), 'utf8'), salt,
      envelope.kdf.iterations || PARAMS.kdf.iterations, PARAMS.keyBytes, 'sha256');
    const data = decryptEnvelopeWithKey(key, envelope); // 密码错会在此抛错
    this.key = key;
    this.salt = salt;
    this.data = data;
    return data;
  }

  // 校验口令是否与当前库一致（导出备份前确认用）
  verifyPassword(password) {
    if (!this.isUnlocked()) return false;
    const candidate = deriveKey(password, this.salt);
    return crypto.timingSafeEqual(candidate, this.key);
  }

  save() {
    if (!this.isUnlocked()) throw new Error('库未解锁');
    this.writeEnvelope(encryptEnvelopeWithKey(this.key, this.salt, this.data));
  }

  changePassword(oldPassword, newPassword) {
    if (!this.verifyPassword(oldPassword)) throw new Error('当前密码不正确');
    this.salt = crypto.randomBytes(PARAMS.kdf.saltBytes);
    this.key = deriveKey(newPassword, this.salt);
    this.save();
  }

  lock() {
    if (this.key) this.key.fill(0);
    this.key = null;
    this.salt = null;
    this.data = null;
  }
}

module.exports = { VaultStore, encryptEnvelope, decryptEnvelope, PARAMS };
