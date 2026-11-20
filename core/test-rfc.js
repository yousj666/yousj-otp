/*
 * RFC 官方测试向量自测（交付前硬验收）
 * 运行：node core/test-rfc.js
 * 覆盖：RFC 6238 TOTP（SHA1/256/512 × 6 个时间点）、RFC 4226 HOTP、
 * RFC 4648 Base32、otpauth 解析冒烟。全部通过退出码为 0。
 */
'use strict';
const assert = require('assert');
const core = require('./otp-core.js');

let passed = 0;
function check(name, actual, expected) {
  assert.strictEqual(actual, expected, `${name}: 期望 ${expected}，实际 ${actual}`);
  passed++;
  console.log(`  ✓ ${name} = ${actual}`);
}

/* ---------- RFC 6238 附录 B：TOTP 测试向量 ---------- */
console.log('RFC 6238 TOTP（8 位，周期 30s）');
const seeds = {
  SHA1: core.utf8Bytes('12345678901234567890'),
  SHA256: core.utf8Bytes('12345678901234567890123456789012'),
  SHA512: core.utf8Bytes('1234567890123456789012345678901234567890123456789012345678901234')
};
const vectors = [
  // [时间(秒), SHA1, SHA256, SHA512]
  [59,          '94287082', '46119246', '90693936'],
  [1111111109,  '07081804', '68084774', '25091201'],
  [1111111111,  '14050471', '67062674', '99943326'],
  [1234567890,  '89005924', '91819424', '93441116'],
  [2000000000,  '69279037', '90698825', '38618901'],
  [20000000000, '65353130', '77737706', '47863826'] // 注：此行 SHA1 经 RFC 6238 原文附录 B 核对为 65353130
];
for (const [t, s1, s256, s512] of vectors) {
  check(`TOTP SHA1   t=${t}`, core.totp(seeds.SHA1, { timestamp: t, digits: 8, algorithm: 'SHA1' }), s1);
  check(`TOTP SHA256 t=${t}`, core.totp(seeds.SHA256, { timestamp: t, digits: 8, algorithm: 'SHA256' }), s256);
  check(`TOTP SHA512 t=${t}`, core.totp(seeds.SHA512, { timestamp: t, digits: 8, algorithm: 'SHA512' }), s512);
}

/* ---------- RFC 4226 附录 D：HOTP 测试向量 ---------- */
console.log('RFC 4226 HOTP（6 位，SHA1）');
const hotpExpected = ['755224', '287082', '359152', '969429', '338314',
                      '254676', '287922', '162583', '399871', '520489'];
hotpExpected.forEach((exp, counter) => {
  check(`HOTP counter=${counter}`, core.hotp(seeds.SHA1, counter, { digits: 6, algorithm: 'SHA1' }), exp);
});

/* ---------- RFC 4648：Base32 测试向量 ---------- */
console.log('RFC 4648 Base32');
const b32Vectors = [
  ['', ''], ['f', 'MY======'], ['fo', 'MZXQ===='], ['foo', 'MZXW6==='],
  ['foob', 'MZXW6YQ='], ['fooba', 'MZXW6YTB'], ['foobar', 'MZXW6YTBOI======']
];
for (const [plain, encoded] of b32Vectors) {
  check(`Base32 编码 "${plain}"`, core.base32Encode(core.utf8Bytes(plain)), encoded);
  check(`Base32 解码 "${encoded}"`, Buffer.from(core.base32Decode(encoded)).toString('utf8'), plain);
}
// 容错：小写、空格、连字符、无填充
check('Base32 容错解码', core.bytesToHex(core.base32Decode('jbsw y3dp-ehpk3pxp')), '48656c6c6f21deadbeef');

/* ---------- 哈希常量冒烟（防常量推导出错） ---------- */
console.log('哈希冒烟（"abc" 已知摘要）');
check('SHA1("abc")', core.bytesToHex(core.sha1(core.utf8Bytes('abc'))),
  'a9993e364706816aba3e25717850c26c9cd0d89d');
check('SHA256("abc")', core.bytesToHex(core.sha256(core.utf8Bytes('abc'))),
  'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
check('SHA512("abc")', core.bytesToHex(core.sha512(core.utf8Bytes('abc'))),
  'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a' +
  '2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f');

/* ---------- otpauth 解析冒烟 ---------- */
console.log('otpauth 解析');
const parsed = core.parseOtpauth(
  'otpauth://totp/GitHub:alice%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub&algorithm=SHA256&digits=8&period=60');
assert(parsed, '解析应成功');
check('otpauth type', parsed.type, 'totp');
check('otpauth issuer', parsed.issuer, 'GitHub');
check('otpauth account', parsed.account, 'alice@example.com');
check('otpauth algorithm', parsed.algorithm, 'SHA256');
check('otpauth digits', parsed.digits, 8);
check('otpauth period', parsed.period, 60);
const parsedHotp = core.parseOtpauth('otpauth://hotp/Test:bob?secret=JBSWY3DPEHPK3PXP&counter=42');
check('otpauth hotp counter', parsedHotp.counter, 42);
check('otpauth 非法链接返回 null', core.parseOtpauth('https://example.com'), null);

console.log(`\n全部通过：${passed} 项断言 ✓`);
