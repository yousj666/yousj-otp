package cc.yousj.otp.totp

import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/** TOTP (RFC 6238) 生成器：30 秒一变 6 位码 */
object Totp {
    const val PERIOD = 30
    const val DIGITS = 6

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

    fun generate(secret: String, period: Int = PERIOD, timeMs: Long = System.currentTimeMillis()): String {
        val key = base32Decode(secret)
        val counter = timeMs / 1000 / period
        val msg = ByteArray(8)
        // 大端 counter
        for (i in 0 until 8) msg[i] = ((counter ushr (56 - i * 8)) and 0xff).toByte()
        val mac = Mac.getInstance("HmacSHA1")
        mac.init(SecretKeySpec(key, "HmacSHA1"))
        val hmac = mac.doFinal(msg)
        val off = (hmac.last().toInt() and 0x0f)
        val mod = Math.pow(10.0, DIGITS.toDouble()).toInt()
        // 注意：Kotlin 中 shl/or 同优先级左结合，必须加括号，否则算错还可能出负数
        val raw = (((hmac[off].toInt() and 0x7f) shl 24) or
                ((hmac[off + 1].toInt() and 0xff) shl 16) or
                ((hmac[off + 2].toInt() and 0xff) shl 8) or
                (hmac[off + 3].toInt() and 0xff))
        val n = raw % mod
        return n.toString().padStart(DIGITS, '0')
    }

    fun secondsLeft(period: Int = PERIOD, timeMs: Long = System.currentTimeMillis()): Int =
        (period - (timeMs / 1000 % period)).toInt()

    /** 解析 otpauth://totp/…?secret=… 链接，返回 (name, secret, period) */
    fun parseOtpAuth(url: String): Triple<String, String, Int>? {
        val m = Regex("^otpauth://totp/([^?]+)\\?(.+)$", RegexOption.IGNORE_CASE).matchEntire(url.trim())
            ?: return null
        val label = java.net.URLDecoder.decode(m.groupValues[1], "UTF-8")
        val params = m.groupValues[2].split("&").associate {
            val kv = it.split("=", limit = 2)
            kv[0] to (if (kv.size > 1) java.net.URLDecoder.decode(kv[1], "UTF-8") else "")
        }
        val secret = params["secret"]?.takeIf { it.isNotBlank() } ?: return null
        val issuer = params["issuer"].orEmpty()
        val period = params["period"]?.toIntOrNull()?.takeIf { it in 10..3600 } ?: PERIOD
        val name = if (":" in label) label.substringAfter(":") else label
        val display = if (issuer.isNotBlank()) "$issuer ($name)" else name
        return Triple(display, secret, period)
    }
}
