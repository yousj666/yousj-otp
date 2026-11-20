package cc.yousj.otp.vault

import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * 保险库加密原语，与桌面版(Node crypto)/插件版(WebCrypto)逐字节一致：
 * - KDF：PBKDF2-HMAC-SHA256，210000 次，盐 16 字节，派生 32 字节密钥；
 *   密码按 UTF-8 编码（手工实现 PBKDF2，避免各平台 PBEKeySpec 编码差异）。
 * - 加密：AES-256-GCM，IV 12 字节，密文布局 ciphertext || tag(16B)，
 *   与 Node cipher.getAuthTag() 拼接及 WebCrypto 输出一致。
 * 本文件只依赖 JVM 标准库，可直接在桌面 JVM 上跑互通自测。
 */
object VaultCrypto {
    const val APP = "yousj-otp"
    const val FORMAT_VERSION = 2
    const val ITERATIONS = 210000
    const val SALT_BYTES = 16
    const val IV_BYTES = 12
    const val TAG_BITS = 128
    const val KEY_BYTES = 32

    private val random = SecureRandom()

    fun randomBytes(n: Int): ByteArray = ByteArray(n).also { random.nextBytes(it) }

    fun b64(data: ByteArray): String = Base64.getEncoder().encodeToString(data)
    fun unb64(s: String): ByteArray = Base64.getDecoder().decode(s)

    /** PBKDF2-HMAC-SHA256（RFC 2898），dkLen=32 时只有一个块 */
    fun pbkdf2(password: String, salt: ByteArray, iterations: Int, dkLen: Int = KEY_BYTES): ByteArray {
        val pwBytes = password.toByteArray(Charsets.UTF_8)
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(pwBytes, "HmacSHA256"))
        val out = ByteArray(dkLen)
        var produced = 0
        var blockIndex = 1
        while (produced < dkLen) {
            // U1 = HMAC(pw, salt || INT32_BE(blockIndex))
            val block = ByteArray(salt.size + 4)
            System.arraycopy(salt, 0, block, 0, salt.size)
            block[salt.size] = ((blockIndex ushr 24) and 0xff).toByte()
            block[salt.size + 1] = ((blockIndex ushr 16) and 0xff).toByte()
            block[salt.size + 2] = ((blockIndex ushr 8) and 0xff).toByte()
            block[salt.size + 3] = (blockIndex and 0xff).toByte()
            var u = mac.doFinal(block)
            val t = u.copyOf()
            for (i in 1 until iterations) {
                u = mac.doFinal(u)
                for (j in t.indices) t[j] = (t[j].toInt() xor u[j].toInt()).toByte()
            }
            val take = minOf(t.size, dkLen - produced)
            System.arraycopy(t, 0, out, produced, take)
            produced += take
            blockIndex++
        }
        return out
    }

    fun deriveKey(password: String, salt: ByteArray, iterations: Int = ITERATIONS): ByteArray =
        pbkdf2(password, salt, iterations, KEY_BYTES)

    /** 加密，返回 (iv, data=ciphertext||tag) */
    fun encrypt(key: ByteArray, plain: ByteArray): Pair<ByteArray, ByteArray> {
        val iv = randomBytes(IV_BYTES)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG_BITS, iv))
        return iv to cipher.doFinal(plain)
    }

    /** 解密，data 为 ciphertext||tag；密码错误时 GCM 校验失败抛 AEADBadTagException */
    fun decrypt(key: ByteArray, iv: ByteArray, data: ByteArray): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG_BITS, iv))
        return cipher.doFinal(data)
    }
}
