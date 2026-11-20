import cc.yousj.otp.totp.Otp
import cc.yousj.otp.vault.VaultCrypto
import java.io.File

/**
 * 桌面 JVM 自测（不进 APK）：
 *  rfc            —— RFC 6238/4226/4648 向量，与 core/test-rfc.js 同期望值
 *  dec <env.json> <expected.txt> <password>  —— 解桌面版(Node)加密的信封并比对明文
 *  enc <plain.txt> <password> <out.json>     —— 用安卓端原语加密，交给 Node 验
 */
fun main(args: Array<String>) {
    when (args[0]) {
        "rfc" -> rfc()
        "dec" -> dec(args[1], args[2], File(args[3]).readText(Charsets.UTF_8))
        "enc" -> enc(args[1], File(args[2]).readText(Charsets.UTF_8), args[3])
        "pbk" -> pbkDebug(args[1], args[2], args[3].toInt())
        else -> error("unknown mode")
    }
}

private fun check(name: String, actual: String, expected: String) {
    check(actual == expected) { "$name: 期望 $expected，实际 $actual" }
    println("  ✓ $name = $actual")
}

private fun rfc() {
    val seeds = mapOf(
        "SHA1" to "12345678901234567890".toByteArray(Charsets.US_ASCII),
        "SHA256" to "12345678901234567890123456789012".toByteArray(Charsets.US_ASCII),
        "SHA512" to "1234567890123456789012345678901234567890123456789012345678901234".toByteArray(Charsets.US_ASCII)
    )
    val vectors = listOf(
        listOf("59", "94287082", "46119246", "90693936"),
        listOf("1111111109", "07081804", "68084774", "25091201"),
        listOf("1111111111", "14050471", "67062674", "99943326"),
        listOf("1234567890", "89005924", "91819424", "93441116"),
        listOf("2000000000", "69279037", "90698825", "38618901"),
        listOf("20000000000", "65353130", "77737706", "47863826")
    )
    for (v in vectors) {
        val t = v[0].toLong()
        check("TOTP SHA1 t=$t", Otp.totp(seeds["SHA1"]!!, t, 30, 8, "SHA1"), v[1])
        check("TOTP SHA256 t=$t", Otp.totp(seeds["SHA256"]!!, t, 30, 8, "SHA256"), v[2])
        check("TOTP SHA512 t=$t", Otp.totp(seeds["SHA512"]!!, t, 30, 8, "SHA512"), v[3])
    }
    val hotpExpected = listOf("755224", "287082", "359152", "969429", "338314",
        "254676", "287922", "162583", "399871", "520489")
    hotpExpected.forEachIndexed { counter, exp ->
        check("HOTP counter=$counter", Otp.hotp(seeds["SHA1"]!!, counter.toLong(), 6, "SHA1"), exp)
    }
    val hex = Otp.base32Decode("jbsw y3dp-ehpk3pxp").joinToString("") { "%02x".format(it) }
    check("Base32 容错解码", hex, "48656c6c6f21deadbeef")
    val p = Otp.parseOtpAuth(
        "otpauth://totp/GitHub:alice%40example.com?secret=<redacted>&issuer=GitHub&algorithm=SHA256&digits=8&period=60")!!
    check("otpauth issuer", p.issuer, "GitHub")
    check("otpauth name", p.name, "alice@example.com")
    check("otpauth algorithm", p.algorithm, "SHA256")
    check("otpauth digits", p.digits.toString(), "8")
    check("otpauth period", p.period.toString(), "60")
    println("RFC 向量全过 ✓")
}

private fun field(json: String, name: String): String {
    val m = Regex("\"$name\"\\s*:\\s*\"([^\"]+)\"").find(json) ?: error("信封缺字段 $name")
    return m.groupValues[1]
}

private fun dec(envFile: String, expectedFile: String, password: String) {
    val env = File(envFile).readText(Charsets.UTF_8)
    check("app 标识", field(env, "app"), "yousj-otp")
    val salt = VaultCrypto.unb64(field(env, "salt"))
    val iterations = Regex("\"iterations\"\\s*:\\s*(\\d+)").find(env)!!.groupValues[1].toInt()
    val iv = VaultCrypto.unb64(field(env, "iv"))
    val data = VaultCrypto.unb64(field(env, "data"))
    val key = VaultCrypto.deriveKey(password, salt, iterations)
    val plain = String(VaultCrypto.decrypt(key, iv, data), Charsets.UTF_8)
    val expected = File(expectedFile).readText(Charsets.UTF_8)
    check("桌面版加密 → 安卓端原语解密（明文逐字节一致）", plain, expected)
    println("跨端解密通过 ✓")
}

private fun enc(plainFile: String, password: String, outFile: String) {
    val plain = File(plainFile).readText(Charsets.UTF_8).toByteArray(Charsets.UTF_8)
    val salt = VaultCrypto.randomBytes(VaultCrypto.SALT_BYTES)
    val key = VaultCrypto.deriveKey(password, salt)
    val (iv, ct) = VaultCrypto.encrypt(key, plain)
    val json = """{"app":"yousj-otp","version":2,""" +
        """"kdf":{"name":"PBKDF2","hash":"SHA-256","iterations":210000,"salt":"${VaultCrypto.b64(salt)}"},""" +
        """"cipher":{"name":"AES-GCM","iv":"${VaultCrypto.b64(iv)}"},""" +
        """"data":"${VaultCrypto.b64(ct)}"}"""
    File(outFile).writeText(json, Charsets.UTF_8)
    println("安卓端原语已加密 → $outFile")
}

fun pbkDebug(password: String, saltB64: String, iterations: Int) {
    val key = VaultCrypto.deriveKey(password, VaultCrypto.unb64(saltB64), iterations)
    println(key.joinToString("") { "%02x".format(it) })
}
