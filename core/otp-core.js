/*
 * Yousj OTP core — 共享核心模块（UMD：Node / Electron / 浏览器插件通用）
 *
 * 内容：Base32 编解码、SHA-1/256/512、HMAC、HOTP(RFC 4226)、TOTP(RFC 6238)、
 * otpauth:// 解析与生成、加密备份格式参数常量。
 *
 * 纯 JS 实现哈希是为了保证桌面版（Node crypto 之外）和插件版（WebCrypto 之外）
 * 的验证码计算结果在任何环境完全一致，且已用 RFC 官方测试向量验证
 * （见 core/test-rfc.js）。
 */
(function (global) {
  'use strict';

  /* ---------------- 工具 ---------------- */

  function utf8Bytes(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) {
        out.push(c);
      } else if (c < 0x800) {
        out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
        var c2 = str.charCodeAt(++i);
        var cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f),
                 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
      } else {
        out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      }
    }
    return new Uint8Array(out);
  }

  function bytesToHex(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) {
      s += ('0' + bytes[i].toString(16)).slice(-2);
    }
    return s;
  }

  /* ---------------- 整数平方根/立方根（BigInt，用于精确推导哈希常量） ---------------- */

  function isqrt(n) { // n: BigInt >= 0
    if (n < 2n) return n;
    var x = n, y = (x + 1n) >> 1n;
    while (y < x) { x = y; y = (x + n / x) >> 1n; }
    return x;
  }

  function icbrt(n) { // n: BigInt >= 0
    if (n < 2n) return n;
    var x = n, y = (2n * x + n / (x * x)) / 3n;
    while (y < x) { x = y; y = (2n * x + n / (x * x)) / 3n; }
    while ((x + 1n) * (x + 1n) * (x + 1n) <= n) x += 1n;
    while (x * x * x > n) x -= 1n;
    return x;
  }

  function firstPrimes(count) {
    var primes = [], n = 2;
    while (primes.length < count) {
      var ok = true;
      for (var i = 0; i < primes.length && primes[i] * primes[i] <= n; i++) {
        if (n % primes[i] === 0) { ok = false; break; }
      }
      if (ok) primes.push(n);
      n++;
    }
    return primes;
  }

  // 取 sqrt(p) / cbrt(p) 小数部分的前 bits 位（精确整数运算）
  function sqrtFrac(p, bits) {
    var b = BigInt(bits), bp = BigInt(p);
    return isqrt(bp << (2n * b)) - (isqrt(bp) << b);
  }
  function cbrtFrac(p, bits) {
    var b = BigInt(bits), bp = BigInt(p);
    return icbrt(bp << (3n * b)) - (icbrt(bp) << b);
  }

  /* ---------------- SHA-256 ---------------- */

  var SHA256_H0 = [], SHA256_K = [];
  (function () {
    var primes = firstPrimes(64), i;
    for (i = 0; i < 8; i++) SHA256_H0.push(Number(sqrtFrac(primes[i], 32)));
    for (i = 0; i < 64; i++) SHA256_K.push(Number(cbrtFrac(primes[i], 32)));
  })();

  function sha256(bytes) {
    var H = SHA256_H0.slice();
    var len = bytes.length;
    var total = Math.ceil((len + 9) / 64) * 64;
    var msg = new Uint8Array(total);
    msg.set(bytes);
    msg[len] = 0x80;
    var dv = new DataView(msg.buffer);
    dv.setUint32(total - 4, len * 8, false); // 位长（<2^32 位足够 OTP 场景）
    var w = new Int32Array(64);
    function rr(x, n) { return (x >>> n) | (x << (32 - n)); }
    for (var off = 0; off < total; off += 64) {
      var t, i2;
      for (t = 0; t < 16; t++) w[t] = dv.getInt32(off + t * 4, false);
      for (t = 16; t < 64; t++) {
        var s0 = rr(w[t - 15], 7) ^ rr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
        var s1 = rr(w[t - 2], 17) ^ rr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (t = 0; t < 64; t++) {
        var S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + SHA256_K[t] + w[t]) | 0;
        var S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22);
        var mj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + mj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0;
        d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
      i2 = 0; // 防 lint 抱怨占位（无实际作用）
    }
    var out = new Uint8Array(32);
    var odv = new DataView(out.buffer);
    for (var j = 0; j < 8; j++) odv.setUint32(j * 4, H[j] >>> 0, false);
    return out;
  }

  /* ---------------- SHA-1 ---------------- */

  function sha1(bytes) {
    var H = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
    var len = bytes.length;
    var total = Math.ceil((len + 9) / 64) * 64;
    var msg = new Uint8Array(total);
    msg.set(bytes);
    msg[len] = 0x80;
    var dv = new DataView(msg.buffer);
    dv.setUint32(total - 4, len * 8, false);
    var w = new Int32Array(80);
    function rl(x, n) { return (x << n) | (x >>> (32 - n)); }
    for (var off = 0; off < total; off += 64) {
      var t;
      for (t = 0; t < 16; t++) w[t] = dv.getInt32(off + t * 4, false);
      for (t = 16; t < 80; t++) w[t] = rl(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1);
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4];
      for (t = 0; t < 80; t++) {
        var f, k;
        if (t < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
        else if (t < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
        else if (t < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
        else { f = b ^ c ^ d; k = 0xca62c1d6; }
        var tmp = (rl(a, 5) + f + e + k + w[t]) | 0;
        e = d; d = c; c = rl(b, 30); b = a; a = tmp;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0;
      H[3] = (H[3] + d) | 0; H[4] = (H[4] + e) | 0;
    }
    var out = new Uint8Array(20);
    var odv = new DataView(out.buffer);
    for (var j = 0; j < 5; j++) odv.setUint32(j * 4, H[j] >>> 0, false);
    return out;
  }

  /* ---------------- SHA-512（BigInt 实现） ---------------- */

  var M64 = (1n << 64n) - 1n;
  var SHA512_H0 = [], SHA512_K = [];
  (function () {
    var primes = firstPrimes(80), i;
    for (i = 0; i < 8; i++) SHA512_H0.push(sqrtFrac(primes[i], 64));
    for (i = 0; i < 80; i++) SHA512_K.push(cbrtFrac(primes[i], 64));
  })();

  function sha512(bytes) {
    var H = SHA512_H0.slice();
    var len = bytes.length;
    var total = Math.ceil((len + 17) / 128) * 128;
    var msg = new Uint8Array(total);
    msg.set(bytes);
    msg[len] = 0x80;
    var dv = new DataView(msg.buffer);
    dv.setUint32(total - 4, len * 8, false); // 位长低 32 位（OTP 场景足够）
    var w = new Array(80);
    function rr(x, n) { var bn = BigInt(n); return ((x >> bn) | (x << (64n - bn))) & M64; }
    for (var off = 0; off < total; off += 128) {
      var t;
      for (t = 0; t < 16; t++) {
        var hi = BigInt(dv.getUint32(off + t * 8, false));
        var lo = BigInt(dv.getUint32(off + t * 8 + 4, false));
        w[t] = (hi << 32n) | lo;
      }
      for (t = 16; t < 80; t++) {
        var s0 = rr(w[t - 15], 1) ^ rr(w[t - 15], 8) ^ (w[t - 15] >> 7n);
        var s1 = rr(w[t - 2], 19) ^ rr(w[t - 2], 61) ^ (w[t - 2] >> 6n);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) & M64;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (t = 0; t < 80; t++) {
        var S1 = rr(e, 14) ^ rr(e, 18) ^ rr(e, 41);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + SHA512_K[t] + w[t]) & M64;
        var S0 = rr(a, 28) ^ rr(a, 34) ^ rr(a, 39);
        var mj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + mj) & M64;
        h = g; g = f; f = e; e = (d + t1) & M64;
        d = c; c = b; b = a; a = (t1 + t2) & M64;
      }
      H[0] = (H[0] + a) & M64; H[1] = (H[1] + b) & M64; H[2] = (H[2] + c) & M64; H[3] = (H[3] + d) & M64;
      H[4] = (H[4] + e) & M64; H[5] = (H[5] + f) & M64; H[6] = (H[6] + g) & M64; H[7] = (H[7] + h) & M64;
    }
    var out = new Uint8Array(64);
    var odv = new DataView(out.buffer);
    for (var j = 0; j < 8; j++) {
      odv.setUint32(j * 8, Number((H[j] >> 32n) & 0xffffffffn), false);
      odv.setUint32(j * 8 + 4, Number(H[j] & 0xffffffffn), false);
    }
    return out;
  }

  /* ---------------- HMAC ---------------- */

  var HASHES = {
    'SHA1': { fn: sha1, block: 64 },
    'SHA256': { fn: sha256, block: 64 },
    'SHA512': { fn: sha512, block: 128 }
  };

  function normalizeAlgo(algo) {
    var a = String(algo || 'SHA1').toUpperCase().replace(/[-_]/g, '');
    if (a === 'SHA1') return 'SHA1';
    if (a === 'SHA256') return 'SHA256';
    if (a === 'SHA512') return 'SHA512';
    throw new Error('不支持的算法: ' + algo);
  }

  function hmac(algorithm, keyBytes, msgBytes) {
    var spec = HASHES[normalizeAlgo(algorithm)];
    var key = keyBytes;
    if (key.length > spec.block) key = spec.fn(key);
    var ipad = new Uint8Array(spec.block), opad = new Uint8Array(spec.block);
    var i;
    for (i = 0; i < spec.block; i++) {
      var kb = i < key.length ? key[i] : 0;
      ipad[i] = kb ^ 0x36;
      opad[i] = kb ^ 0x5c;
    }
    var inner = new Uint8Array(spec.block + msgBytes.length);
    inner.set(ipad); inner.set(msgBytes, spec.block);
    var innerHash = spec.fn(inner);
    var outer = new Uint8Array(spec.block + innerHash.length);
    outer.set(opad); outer.set(innerHash, spec.block);
    return spec.fn(outer);
  }

  /* ---------------- Base32 (RFC 4648) ---------------- */

  var B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  var B32_MAP = {};
  (function () {
    for (var i = 0; i < B32_ALPHABET.length; i++) B32_MAP[B32_ALPHABET[i]] = i;
  })();

  function base32Decode(str) {
    var clean = String(str || '').toUpperCase().replace(/[\s=-]+/g, '');
    var out = [];
    var bits = 0, value = 0;
    for (var i = 0; i < clean.length; i++) {
      var v = B32_MAP[clean[i]];
      if (v === undefined) throw new Error('密钥含有非法字符: ' + clean[i]);
      value = (value << 5) | v;
      bits += 5;
      if (bits >= 8) {
        out.push((value >>> (bits - 8)) & 0xff);
        bits -= 8;
      }
    }
    return new Uint8Array(out);
  }

  function base32Encode(bytes) {
    var out = '', bits = 0, value = 0;
    for (var i = 0; i < bytes.length; i++) {
      value = (value << 8) | bytes[i];
      bits += 8;
      while (bits >= 5) {
        out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }
    if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
    while (out.length % 8 !== 0) out += '=';
    return out;
  }

  /* ---------------- HOTP / TOTP ---------------- */

  function hotp(secretBytes, counter, options) {
    options = options || {};
    var digits = options.digits || 6;
    var algorithm = normalizeAlgo(options.algorithm || 'SHA1');
    var msg = new Uint8Array(8);
    var c = counter;
    for (var i = 7; i >= 0; i--) {
      msg[i] = c & 0xff;
      c = Math.floor(c / 256);
    }
    var hash = hmac(algorithm, secretBytes, msg);
    var offset = hash[hash.length - 1] & 0x0f;
    var binary = ((hash[offset] & 0x7f) << 24) |
                 ((hash[offset + 1] & 0xff) << 16) |
                 ((hash[offset + 2] & 0xff) << 8) |
                 (hash[offset + 3] & 0xff);
    var code = binary % Math.pow(10, digits);
    var s = String(code);
    while (s.length < digits) s = '0' + s;
    return s;
  }

  function totp(secretBytes, options) {
    options = options || {};
    var period = options.period || 30;
    var time = (options.timestamp !== undefined)
      ? options.timestamp
      : Math.floor(Date.now() / 1000);
    var counter = Math.floor(time / period);
    return hotp(secretBytes, counter, options);
  }

  // 当前周期剩余秒数（用于倒计时环）
  function remainingSeconds(period, timestamp) {
    period = period || 30;
    var time = (timestamp !== undefined) ? timestamp : Math.floor(Date.now() / 1000);
    return period - (time % period);
  }

  // 从 Base32 密钥字符串直接算码（UI 常用入口）
  function codeFromSecret(secretBase32, options) {
    options = options || {};
    var secret = base32Decode(secretBase32);
    if ((options.type || 'totp') === 'hotp') {
      return hotp(secret, options.counter || 0, options);
    }
    return totp(secret, options);
  }

  /* ---------------- otpauth:// 解析 / 生成 ---------------- */

  function parseQuery(qs) {
    var out = {};
    if (!qs) return out;
    var pairs = qs.split('&');
    for (var i = 0; i < pairs.length; i++) {
      if (!pairs[i]) continue;
      var idx = pairs[i].indexOf('=');
      var k = idx >= 0 ? pairs[i].slice(0, idx) : pairs[i];
      var v = idx >= 0 ? pairs[i].slice(idx + 1) : '';
      try { out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' ')); }
      catch (e) { out[k] = v; }
    }
    return out;
  }

  function parseOtpauth(uri) {
    if (!uri || typeof uri !== 'string') return null;
    var m = uri.trim().match(/^otpauth:\/\/(totp|hotp)\/(.+)$/i);
    if (!m) return null;
    var type = m[1].toLowerCase();
    var rest = m[2];
    var qIdx = rest.indexOf('?');
    var labelRaw = qIdx >= 0 ? rest.slice(0, qIdx) : rest;
    var query = parseQuery(qIdx >= 0 ? rest.slice(qIdx + 1) : '');
    var label = '';
    try { label = decodeURIComponent(labelRaw); } catch (e) { label = labelRaw; }
    var issuer = query.issuer || '';
    var account = label;
    var colon = label.indexOf(':');
    if (colon >= 0) {
      if (!issuer) issuer = label.slice(0, colon).trim();
      account = label.slice(colon + 1).trim();
    }
    if (!query.secret) return null;
    var secret;
    try { secret = base32Decode(query.secret); } catch (e) { return null; }
    if (secret.length === 0) return null;
    var result = {
      type: type,
      label: label,
      issuer: issuer,
      account: account,
      name: account,
      secret: String(query.secret).toUpperCase().replace(/[\s-]+/g, ''),
      algorithm: normalizeAlgo(query.algorithm || 'SHA1'),
      digits: parseInt(query.digits, 10) || 6,
      period: parseInt(query.period, 10) || 30
    };
    if (type === 'hotp') {
      result.counter = parseInt(query.counter, 10) || 0;
    }
    return result;
  }

  function buildOtpauth(acct) {
    var type = acct.type || 'totp';
    var label = acct.issuer
      ? encodeURIComponent(acct.issuer) + ':' + encodeURIComponent(acct.name || '')
      : encodeURIComponent(acct.name || '');
    var params = ['secret=' + encodeURIComponent(acct.secret || '')];
    if (acct.issuer) params.push('issuer=' + encodeURIComponent(acct.issuer));
    params.push('algorithm=' + (acct.algorithm || 'SHA1'));
    params.push('digits=' + (acct.digits || 6));
    if (type === 'hotp') params.push('counter=' + (acct.counter || 0));
    else params.push('period=' + (acct.period || 30));
    return 'otpauth://' + type + '/' + label + '?' + params.join('&');
  }

  /* ---------------- 加密备份格式参数（桌面版与插件版必须一致） ---------------- */

  var VAULT_PARAMS = {
    app: 'yousj-otp',
    formatVersion: 2,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 210000, saltBytes: 16 },
    cipher: { name: 'AES-GCM', ivBytes: 12, tagBytes: 16 },
    keyBytes: 32
  };

  var api = {
    utf8Bytes: utf8Bytes,
    bytesToHex: bytesToHex,
    sha1: sha1,
    sha256: sha256,
    sha512: sha512,
    hmac: hmac,
    normalizeAlgo: normalizeAlgo,
    base32Decode: base32Decode,
    base32Encode: base32Encode,
    hotp: hotp,
    totp: totp,
    remainingSeconds: remainingSeconds,
    codeFromSecret: codeFromSecret,
    parseOtpauth: parseOtpauth,
    buildOtpauth: buildOtpauth,
    VAULT_PARAMS: VAULT_PARAMS
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.OtpCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
