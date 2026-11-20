package cc.yousj.otp.totp

import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * OTP 核心逻辑，与 core/otp-core.js 等价：
 * TOTP (RFC 6238) / HOTP (RFC 4226)，支持 SHA1/SHA256/SHA512、6/8 位、任意周期。
 */
object Otp {
    const val DEFAULT_PERIOD = 30
    const val DEFAULT_DIGITS = 6

    private const val ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

    fun base32Decode(s: String): ByteArray {
        val clean = s.uppercase().filter { it in ALPHA }
        var bits = 0
        var value = 0
        val out = mutableListOf<Byte>()
        for (c in clean) {
            value = (value shl 5) or ALPHA.indexOf(c)
            bits += 5
            if (bits >= 8) {
                out.add(((value ushr (bits - 8)) and 0xff).toByte())
                bits -= 8
            }
        }
        return out.toByteArray()
    }

    fun normalizeSecret(s: String): String =
        s.uppercase().filter { it in ALPHA || it == '=' }

    private fun macName(algorithm: String): String = when (algorithm.uppercase()) {
        "SHA256" -> "HmacSHA256"
        "SHA512" -> "HmacSHA512"
        else -> "HmacSHA1"
    }

    fun hotp(key: ByteArray, counter: Long, digits: Int = DEFAULT_DIGITS, algorithm: String = "SHA1"): String {
        val msg = ByteArray(8)
        for (i in 0 until 8) msg[i] = ((counter ushr (56 - i * 8)) and 0xff).toByte()
        val mac = Mac.getInstance(macName(algorithm))
        mac.init(SecretKeySpec(key, macName(algorithm)))
        val h = mac.doFinal(msg)
        val off = h.last().toInt() and 0x0f
        val raw = (((h[off].toInt() and 0x7f) shl 24) or
                ((h[off + 1].toInt() and 0xff) shl 16) or
                ((h[off + 2].toInt() and 0xff) shl 8) or
                (h[off + 3].toInt() and 0xff))
        var mod = 1
        repeat(digits) { mod *= 10 }
        return (raw % mod).toString().padStart(digits, '0')
    }

    fun totp(key: ByteArray, timeSec: Long, period: Int = DEFAULT_PERIOD,
             digits: Int = DEFAULT_DIGITS, algorithm: String = "SHA1"): String =
        hotp(key, timeSec / period, digits, algorithm)

    fun codeForSecret(secret: String, timeMs: Long = System.currentTimeMillis(),
                      period: Int = DEFAULT_PERIOD, digits: Int = DEFAULT_DIGITS,
                      algorithm: String = "SHA1"): String =
        totp(base32Decode(secret), timeMs / 1000, period, digits, algorithm)

    fun hotpForSecret(secret: String, counter: Long, digits: Int = DEFAULT_DIGITS,
                      algorithm: String = "SHA1"): String =
        hotp(base32Decode(secret), counter, digits, algorithm)

    fun secondsLeft(period: Int = DEFAULT_PERIOD, timeMs: Long = System.currentTimeMillis()): Int =
        (period - (timeMs / 1000 % period)).toInt()

    /** 把码按 3+3 / 4+4 分组显示 */
    fun groupCode(code: String): String = when (code.length) {
        6 -> "${code.substring(0, 3)} ${code.substring(3)}"
        8 -> "${code.substring(0, 4)} ${code.substring(4)}"
        else -> code
    }

    data class Parsed(
        val type: String,       // totp / hotp
        val name: String,
        val issuer: String,
        val secret: String,
        val algorithm: String,  // SHA1 / SHA256 / SHA512
        val digits: Int,
        val period: Int,
        val counter: Long
    )

    /** 生成 otpauth:// 链接，口径与 core/otp-core.js buildOtpauth 一致（用于出示二维码） */
    fun buildOtpAuth(type: String, name: String, issuer: String, secret: String,
                     algorithm: String, digits: Int, period: Int, counter: Long): String {
        fun enc(s: String): String = java.net.URLEncoder.encode(s, "UTF-8")
            .replace("+", "%20").replace("*", "%2A").replace("%7E", "~")
        val label = if (issuer.isNotBlank()) "${enc(issuer)}:${enc(name)}" else enc(name)
        val params = mutableListOf("secret=$secret")
        if (issuer.isNotBlank()) params.add("issuer=${enc(issuer)}")
        params.add("algorithm=$algorithm")
        params.add("digits=$digits")
        if (type == "hotp") params.add("counter=$counter") else params.add("period=$period")
        return "otpauth://$type/$label?${params.joinToString("&")}"
    }

    /** 解析 otpauth:// 链接，字段口径与 core/otp-core.js parseOtpauth 一致 */
    fun parseOtpAuth(url: String): Parsed? {
        val m = Regex("^otpauth://(totp|hotp)/(.+)$", RegexOption.IGNORE_CASE)
            .matchEntire(url.trim()) ?: return null
        val type = m.groupValues[1].lowercase()
        val rest = m.groupValues[2]
        val qIdx = rest.indexOf('?')
        val labelRaw = if (qIdx >= 0) rest.substring(0, qIdx) else rest
        val queryRaw = if (qIdx >= 0) rest.substring(qIdx + 1) else ""
        fun dec(s: String): String = try {
            java.net.URLDecoder.decode(s.replace("+", "%2B"), "UTF-8")
        } catch (e: Exception) { s }
        val label = dec(labelRaw)
        val params = mutableMapOf<String, String>()
        if (queryRaw.isNotBlank()) {
            for (pair in queryRaw.split("&")) {
                val i = pair.indexOf('=')
                if (i >= 0) params[dec(pair.substring(0, i))] = dec(pair.substring(i + 1))
                else params[dec(pair)] = ""
            }
        }
        val secretRaw = params["secret"]?.takeIf { it.isNotBlank() } ?: return null
        val secret = normalizeSecret(secretRaw)
        if (secret.isEmpty() || base32Decode(secret).isEmpty()) return null
        var issuer = params["issuer"].orEmpty()
        var account = label
        val colon = label.indexOf(':')
        if (colon >= 0) {
            if (issuer.isEmpty()) issuer = label.substring(0, colon).trim()
            account = label.substring(colon + 1).trim()
        }
        val algorithm = when (params["algorithm"]?.uppercase()) {
            "SHA256" -> "SHA256"
            "SHA512" -> "SHA512"
            else -> "SHA1"
        }
        val digits = params["digits"]?.toIntOrNull()?.takeIf { it == 6 || it == 8 } ?: DEFAULT_DIGITS
        val period = params["period"]?.toIntOrNull()?.takeIf { it in 10..3600 } ?: DEFAULT_PERIOD
        val counter = params["counter"]?.toLongOrNull() ?: 0L
        return Parsed(type, account, issuer, secret, algorithm, digits, period, counter)
    }
}
