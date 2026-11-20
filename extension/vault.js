/*
 * 插件版加密库（WebCrypto 实现）
 * 格式与桌面版（Node crypto）严格一致，参数取自 core 的 VAULT_PARAMS：
 * PBKDF2-HMAC-SHA256 210000 次派生 32 字节密钥，AES-256-GCM 加密整个库 JSON。
 * WebCrypto 的 AES-GCM 输出天然是 ciphertext || tag(16B)，与桌面版布局一致。
 * UMD-lite：浏览器里挂 globalThis.ExtVault，Node 里可 require 做兼容测试。
 */
(function (g) {
  'use strict';

  var PARAMS = (typeof OtpCore !== 'undefined' && OtpCore.VAULT_PARAMS) || {
    app: 'yousj-otp', formatVersion: 2,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 210000, saltBytes: 16 },
    cipher: { name: 'AES-GCM', ivBytes: 12, tagBytes: 16 },
    keyBytes: 32
  };

  function b64encode(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function b64decode(str) {
    var bin = atob(str);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function deriveKey(password, saltBytes, iterations) {
    var base = await crypto.subtle.importKey('raw',
      new TextEncoder().encode(String(password)), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: saltBytes, iterations: iterations || PARAMS.kdf.iterations, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: PARAMS.keyBytes * 8 }, false, ['encrypt', 'decrypt']);
  }

  async function encryptEnvelope(dataObj, password) {
    var salt = crypto.getRandomValues(new Uint8Array(PARAMS.kdf.saltBytes));
    var iv = crypto.getRandomValues(new Uint8Array(PARAMS.cipher.ivBytes));
    var key = await deriveKey(password, salt);
    var plain = new TextEncoder().encode(JSON.stringify(dataObj));
    var ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, plain);
    return {
      app: PARAMS.app,
      version: PARAMS.formatVersion,
      kdf: { name: PARAMS.kdf.name, hash: PARAMS.kdf.hash, iterations: PARAMS.kdf.iterations, salt: b64encode(salt) },
      cipher: { name: 'AES-GCM', iv: b64encode(iv) },
      data: b64encode(new Uint8Array(ct))
    };
  }

  async function decryptEnvelope(envelope, password) {
    if (!envelope || envelope.app !== PARAMS.app || !envelope.kdf || !envelope.cipher) {
      throw new Error('不是有效的 Yousj OTP 备份文件');
    }
    var salt = b64decode(envelope.kdf.salt);
    var iv = b64decode(envelope.cipher.iv);
    var key = await deriveKey(password, salt, envelope.kdf.iterations);
    var plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, b64decode(envelope.data));
    return JSON.parse(new TextDecoder().decode(plain));
  }

  /* ---- chrome.storage 封装（本地存信封，会话存解锁态） ---- */

  var STORAGE_KEY = 'yousjOtpVault';
  var SESSION_KEY = 'yousjOtpSession';

  function storageGet(area, key) {
    return new Promise(function (resolve) {
      chrome.storage[area].get(key, function (res) { resolve(res && res[key]); });
    });
  }
  function storageSet(area, obj) {
    return new Promise(function (resolve) { chrome.storage[area].set(obj, resolve); });
  }
  function storageRemove(area, key) {
    return new Promise(function (resolve) { chrome.storage[area].remove(key, resolve); });
  }

  async function loadStoredEnvelope() {
    return (await storageGet('local', STORAGE_KEY)) || null;
  }
  async function saveStoredEnvelope(envelope) {
    var obj = {}; obj[STORAGE_KEY] = envelope;
    await storageSet('local', obj);
  }
  // 解锁态只放 storage.session（内存型，浏览器关闭即清）
  async function saveSession(password, data) {
    var obj = {}; obj[SESSION_KEY] = { password: password, data: data, unlockedAt: Date.now() };
    await storageSet('session', obj);
  }
  async function loadSession() {
    return (await storageGet('session', SESSION_KEY)) || null;
  }
  async function clearSession() {
    await storageRemove('session', SESSION_KEY);
  }

  var api = {
    PARAMS: PARAMS,
    encryptEnvelope: encryptEnvelope,
    decryptEnvelope: decryptEnvelope,
    loadStoredEnvelope: loadStoredEnvelope,
    saveStoredEnvelope: saveStoredEnvelope,
    saveSession: saveSession,
    loadSession: loadSession,
    clearSession: clearSession,
    STORAGE_KEY: STORAGE_KEY,
    SESSION_KEY: SESSION_KEY
  };
  g.ExtVault = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
