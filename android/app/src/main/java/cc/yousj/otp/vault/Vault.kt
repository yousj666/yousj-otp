package cc.yousj.otp.vault

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

/* ---------- 数据模型：字段名与桌面版/插件版完全一致 ---------- */

data class Account(
    var id: String = UUID.randomUUID().toString(),
    var name: String = "",
    var issuer: String = "",
    var secret: String = "",
    var algorithm: String = "SHA1",   // SHA1 / SHA256 / SHA512
    var digits: Int = 6,
    var period: Int = 30,
    var type: String = "totp",        // totp / hotp
    var counter: Long = 0
) {
    fun toJson(): JSONObject = JSONObject()
        .put("id", id).put("name", name).put("issuer", issuer).put("secret", secret)
        .put("algorithm", algorithm).put("digits", digits).put("period", period)
        .put("type", type).put("counter", counter)

    companion object {
        fun fromJson(o: JSONObject): Account = Account(
            id = o.optString("id", UUID.randomUUID().toString()),
            name = o.optString("name", ""),
            issuer = o.optString("issuer", ""),
            secret = o.optString("secret", ""),
            algorithm = o.optString("algorithm", "SHA1"),
            digits = o.optInt("digits", 6),
            period = o.optInt("period", 30),
            type = o.optString("type", "totp"),
            counter = o.optLong("counter", 0)
        )
    }
}

data class DiaryEntry(
    var id: String = UUID.randomUUID().toString(),
    var date: String = "",            // yyyy-MM-dd
    var title: String = "",
    var body: String = "",
    var mood: String = "",
    var createdAt: Long = 0,
    var updatedAt: Long = 0
) {
    fun toJson(): JSONObject = JSONObject()
        .put("id", id).put("date", date).put("title", title).put("body", body)
        .put("mood", mood).put("createdAt", createdAt).put("updatedAt", updatedAt)

    companion object {
        fun fromJson(o: JSONObject): DiaryEntry = DiaryEntry(
            id = o.optString("id", UUID.randomUUID().toString()),
            date = o.optString("date", ""),
            title = o.optString("title", ""),
            body = o.optString("body", ""),
            mood = o.optString("mood", ""),
            createdAt = o.optLong("createdAt", 0),
            updatedAt = o.optLong("updatedAt", 0)
        )
    }
}

class VaultData {
    val accounts: MutableList<Account> = mutableListOf()
    val diary: MutableList<DiaryEntry> = mutableListOf()
    var autoLockMinutes: Int = 5

    fun toJson(): JSONObject {
        val acc = JSONArray(); accounts.forEach { acc.put(it.toJson()) }
        val dia = JSONArray(); diary.forEach { dia.put(it.toJson()) }
        return JSONObject()
            .put("accounts", acc)
            .put("diary", dia)
            .put("settings", JSONObject().put("autoLockMinutes", autoLockMinutes))
    }

    companion object {
        fun fromJson(o: JSONObject): VaultData {
            val d = VaultData()
            val acc = o.optJSONArray("accounts") ?: JSONArray()
            for (i in 0 until acc.length()) d.accounts.add(Account.fromJson(acc.getJSONObject(i)))
            val dia = o.optJSONArray("diary") ?: JSONArray()
            for (i in 0 until dia.length()) d.diary.add(DiaryEntry.fromJson(dia.getJSONObject(i)))
            d.autoLockMinutes = o.optJSONObject("settings")?.optInt("autoLockMinutes", 5) ?: 5
            return d
        }
    }
}

/* ---------- 信封（备份文件格式）：与 desktop/vault.js、extension/vault.js 严格一致 ---------- */

object Envelope {
    fun encrypt(data: VaultData, password: String): JSONObject {
        val salt = VaultCrypto.randomBytes(VaultCrypto.SALT_BYTES)
        val key = VaultCrypto.deriveKey(password, salt)
        return encryptWithKey(data, key, salt)
    }

    fun encryptWithKey(data: VaultData, key: ByteArray, salt: ByteArray): JSONObject {
        val plain = data.toJson().toString().toByteArray(Charsets.UTF_8)
        val (iv, ct) = VaultCrypto.encrypt(key, plain)
        return JSONObject()
            .put("app", VaultCrypto.APP)
            .put("version", VaultCrypto.FORMAT_VERSION)
            .put("kdf", JSONObject()
                .put("name", "PBKDF2").put("hash", "SHA-256")
                .put("iterations", VaultCrypto.ITERATIONS)
                .put("salt", VaultCrypto.b64(salt)))
            .put("cipher", JSONObject()
                .put("name", "AES-GCM")
                .put("iv", VaultCrypto.b64(iv)))
            .put("data", VaultCrypto.b64(ct))
    }

    /** 解密信封，返回 (数据, 派生密钥, 盐)；密码错误抛异常 */
    fun decrypt(env: JSONObject, password: String): Triple<VaultData, ByteArray, ByteArray> {
        if (env.optString("app") != VaultCrypto.APP || !env.has("kdf") || !env.has("cipher")) {
            throw IllegalArgumentException("不是有效的 Yousj OTP 备份文件")
        }
        val kdf = env.getJSONObject("kdf")
        val cipher = env.getJSONObject("cipher")
        val salt = VaultCrypto.unb64(kdf.getString("salt"))
        val iterations = kdf.optInt("iterations", VaultCrypto.ITERATIONS)
        val key = VaultCrypto.deriveKey(password, salt, iterations)
        val iv = VaultCrypto.unb64(cipher.getString("iv"))
        val raw = VaultCrypto.unb64(env.getString("data"))
        val plain = VaultCrypto.decrypt(key, iv, raw)
        val data = VaultData.fromJson(JSONObject(String(plain, Charsets.UTF_8)))
        return Triple(data, key, salt)
    }
}

/* ---------- 本地库存储（filesDir/vault.json，内容即信封 JSON） ---------- */

class VaultStore(private val file: File) {
    var key: ByteArray? = null; private set
    var salt: ByteArray? = null; private set
    var data: VaultData? = null; private set

    fun exists(): Boolean = file.exists()
    fun isUnlocked(): Boolean = key != null && data != null

    fun setup(password: String, initial: VaultData) {
        salt = VaultCrypto.randomBytes(VaultCrypto.SALT_BYTES)
        key = VaultCrypto.deriveKey(password, salt!!)
        data = initial
        save()
    }

    fun unlock(password: String): VaultData {
        val env = JSONObject(file.readText(Charsets.UTF_8))
        val (d, k, s) = Envelope.decrypt(env, password)
        data = d; key = k; salt = s
        return d
    }

    fun verifyPassword(password: String): Boolean {
        if (!isUnlocked()) return false
        val candidate = VaultCrypto.deriveKey(password, salt!!)
        return candidate.contentEquals(key!!)
    }

    fun save() {
        check(isUnlocked()) { "库未解锁" }
        val env = Envelope.encryptWithKey(data!!, key!!, salt!!)
        file.writeText(env.toString(2), Charsets.UTF_8)
    }

    fun changePassword(oldPassword: String, newPassword: String) {
        if (!verifyPassword(oldPassword)) throw IllegalArgumentException("当前密码不正确")
        salt = VaultCrypto.randomBytes(VaultCrypto.SALT_BYTES)
        key = VaultCrypto.deriveKey(newPassword, salt!!)
        save()
    }

    fun lock() {
        key?.fill(0)
        key = null; salt = null; data = null
    }
}
