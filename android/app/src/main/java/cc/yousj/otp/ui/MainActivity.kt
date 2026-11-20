package cc.yousj.otp.ui

import android.app.Activity
import android.app.AlertDialog
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.widget.*
import cc.yousj.otp.totp.Otp
import cc.yousj.otp.vault.Account
import cc.yousj.otp.vault.DiaryEntry
import cc.yousj.otp.vault.Envelope
import cc.yousj.otp.vault.VaultData
import cc.yousj.otp.vault.VaultStore
import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.RGBLuminanceSource
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader
import com.google.zxing.qrcode.QRCodeWriter
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Yousj OTP 安卓版 v2：界面沿用 v1 自有风格（深灰底 + 橙色点缀 + 圆角卡片），
 * 功能对齐桌面/插件版：加密库（PBKDF2+AES-GCM，备份互通）、验证码/日记/备份/设置四页。
 */
class MainActivity : Activity() {

    /* ---------- v1 风格常量 ---------- */
    private val BG = Color.parseColor("#1a1a1a")
    private val BAR = Color.parseColor("#222222")
    private val CARD = Color.parseColor("#262626")
    private val CARD_HI = Color.parseColor("#2e2e2e")
    private val ACCENT = Color.parseColor("#f5a623")
    private val WHITE = Color.WHITE
    private val MUTED = Color.parseColor("#aaaaaa")
    private val DANGER = Color.parseColor("#ff6b6b")
    private val INPUT_BG = Color.parseColor("#1f1f1f")

    private val handler = Handler(Looper.getMainLooper())
    private lateinit var store: VaultStore
    private var lastActiveMs = System.currentTimeMillis()

    private lateinit var contentFrame: FrameLayout
    private val navButtons = mutableMapOf<String, TextView>()
    private var currentPage = "codes"
    private var codesListLayout: LinearLayout? = null
    private var codesSearch: EditText? = null
    private var diaryListLayout: LinearLayout? = null
    private var diarySearch: EditText? = null
    // 验证码卡片上的动态文本引用，tick 时原地更新，避免整表重建丢滚动位置
    private val codeViews = mutableMapOf<String, Pair<TextView, TextView>>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = VaultStore(File(filesDir, "vault.json"))
        if (store.exists()) showUnlock() else showSetup()
        tick()
    }

    /* ---------- 通用小部件 ---------- */
    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    private fun rounded(color: Int, radiusDp: Int, strokeColor: Int? = null): GradientDrawable =
        GradientDrawable().apply {
            setColor(color)
            cornerRadius = dp(radiusDp).toFloat()
            if (strokeColor != null) setStroke(dp(1), strokeColor)
        }

    private fun label(text: String, size: Float = 13f, color: Int = MUTED): TextView =
        TextView(this).apply {
            this.text = text; textSize = size; setTextColor(color)
        }

    private fun input(hint: String, password: Boolean = false, number: Boolean = false): EditText =
        EditText(this).apply {
            this.hint = hint
            setTextColor(WHITE); setHintTextColor(Color.parseColor("#777777"))
            textSize = 15f
            background = rounded(INPUT_BG, 10, Color.parseColor("#3a3a3a"))
            setPadding(dp(14), dp(10), dp(14), dp(10))
            inputType = when {
                password -> InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
                number -> InputType.TYPE_CLASS_NUMBER
                else -> InputType.TYPE_CLASS_TEXT
            }
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(12) }
        }

    private fun accentButton(text: String, onClick: () -> Unit): Button =
        Button(this).apply {
            this.text = text; textSize = 15f
            setTextColor(Color.parseColor("#1a1a1a"))
            background = rounded(ACCENT, 10)
            setPadding(dp(18), dp(6), dp(18), dp(6))
            setOnClickListener { onClick() }
        }

    private fun ghostButton(text: String, onClick: () -> Unit): Button =
        Button(this).apply {
            this.text = text; textSize = 14f
            setTextColor(ACCENT)
            background = rounded(CARD_HI, 10, Color.parseColor("#3a3a3a"))
            setPadding(dp(14), dp(4), dp(14), dp(4))
            setOnClickListener { onClick() }
        }

    private fun smallLink(text: String, color: Int = MUTED, onClick: () -> Unit): TextView =
        TextView(this).apply {
            this.text = text; textSize = 14f; setTextColor(color)
            setPadding(dp(10), dp(6), dp(10), dp(6))
            setOnClickListener { onClick() }
        }

    private fun toast(msg: String, long: Boolean = false) =
        Toast.makeText(this, msg, if (long) Toast.LENGTH_LONG else Toast.LENGTH_SHORT).show()

    private fun dialogBox(title: String, body: View): AlertDialog {
        val wrap = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = rounded(BAR, 16)
            setPadding(dp(22), dp(20), dp(22), dp(20))
        }
        wrap.addView(TextView(this).apply {
            text = title; textSize = 17f; setTextColor(WHITE)
            typeface = Typeface.DEFAULT_BOLD
            setPadding(0, 0, 0, dp(14))
        })
        wrap.addView(body)
        val d = AlertDialog.Builder(this).setView(wrap).create()
        d.window?.setBackgroundDrawableResource(android.R.color.transparent)
        return d
    }

    private fun confirmDialog(title: String, message: String, onYes: () -> Unit) {
        val body = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        body.addView(label(message, 14f, WHITE))
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.END
            setPadding(0, dp(16), 0, 0)
        }
        lateinit var d: AlertDialog
        row.addView(ghostButton("取消") { d.dismiss() })
        row.addView(Space(this).apply { minimumWidth = dp(10) })
        row.addView(accentButton("确定") { d.dismiss(); onYes() })
        body.addView(row)
        d = dialogBox(title, body)
        d.show()
    }

    /* ---------- 解锁 / 建库 ---------- */
    private fun lockScreenWrap(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setBackgroundColor(BG)
        setPadding(dp(28), dp(64), dp(28), dp(28))
        gravity = Gravity.CENTER_HORIZONTAL
    }

    private fun showSetup() {
        val root = lockScreenWrap()
        root.addView(TextView(this).apply {
            text = "Yousj OTP"; textSize = 26f; setTextColor(ACCENT)
            typeface = Typeface.DEFAULT_BOLD; gravity = Gravity.CENTER
        })
        root.addView(label("设置一个主密码，账号和日记都会加密保存在本机", 13f).apply {
            gravity = Gravity.CENTER; setPadding(0, dp(10), 0, dp(30))
        })
        val pw1 = input("主密码", password = true)
        val pw2 = input("再输一次主密码", password = true)
        root.addView(pw1); root.addView(pw2)
        root.addView(accentButton("创建加密库") {
            val a = pw1.text.toString(); val b = pw2.text.toString()
            if (a.length < 4) { toast("密码至少 4 位"); return@accentButton }
            if (a != b) { toast("两次密码不一致"); return@accentButton }
            store.setup(a, VaultData())
            migrateLegacy()
            toast("加密库已创建")
            showMain()
        }.apply { layoutParams = LinearLayout.LayoutParams(-1, -2) })
        setContentView(root)
    }

    private fun showUnlock() {
        val root = lockScreenWrap()
        root.addView(TextView(this).apply {
            text = "Yousj OTP"; textSize = 26f; setTextColor(ACCENT)
            typeface = Typeface.DEFAULT_BOLD; gravity = Gravity.CENTER
        })
        root.addView(label("输入主密码解锁", 13f).apply {
            gravity = Gravity.CENTER; setPadding(0, dp(10), 0, dp(30))
        })
        val pw = input("主密码", password = true)
        root.addView(pw)
        root.addView(accentButton("解锁") {
            try {
                store.unlock(pw.text.toString())
                migrateLegacy()
                lastActiveMs = System.currentTimeMillis()
                showMain()
            } catch (e: Exception) {
                toast("密码不对")
            }
        }.apply { layoutParams = LinearLayout.LayoutParams(-1, -2) })
        setContentView(root)
    }

    /** v1 明文账号迁移：旧 SharedPreferences 里还有账号且新库为空时并入，随后清掉旧数据 */
    private fun migrateLegacy() {
        val prefs = getSharedPreferences("otp_accounts", Context.MODE_PRIVATE)
        val s = prefs.getString("list", null) ?: return
        val data = store.data ?: return
        try {
            val arr = JSONArray(s)
            if (arr.length() == 0) return
            var added = 0
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                var p = o.optInt("period", 30).takeIf { it in 10..3600 } ?: 30
                if (p == 15) p = 30 // v1 旧默认误写 15 秒，迁到标准 30 秒
                val secret = Otp.normalizeSecret(o.optString("secret", ""))
                if (secret.isEmpty()) continue
                // 旧名形如 "Issuer (name)" 时拆回发行方/名称
                val rawName = o.optString("name", "")
                val m = Regex("^(.*) \\((.*)\\)$").matchEntire(rawName)
                val issuer = m?.groupValues?.get(1) ?: ""
                val name = m?.groupValues?.get(2) ?: rawName
                data.accounts.add(Account(name = name, issuer = issuer, secret = secret, period = p))
                added++
            }
            if (added > 0) {
                store.save()
                toast("已迁移旧版 $added 个账号")
            }
            prefs.edit().remove("list").apply()
        } catch (e: Exception) { /* 旧数据损坏就跳过，不挡解锁 */ }
    }

    /* ---------- 主框架 ---------- */
    private fun showMain() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(BG)
        }
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(BAR)
            setPadding(dp(20), dp(16), dp(12), dp(16))
            gravity = Gravity.CENTER_VERTICAL
        }
        bar.addView(TextView(this).apply {
            text = "Yousj OTP"; textSize = 18f; setTextColor(ACCENT)
            typeface = Typeface.DEFAULT_BOLD
            layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
        })
        bar.addView(smallLink("锁定") { doLock() })
        root.addView(bar)

        contentFrame = FrameLayout(this)
        root.addView(contentFrame, LinearLayout.LayoutParams(-1, 0, 1f))

        val nav = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(BAR)
            setPadding(dp(8), dp(6), dp(8), dp(10))
        }
        navButtons.clear()
        listOf("codes" to "验证码", "diary" to "日记", "backup" to "备份", "settings" to "设置")
            .forEach { (key, text) ->
                val tv = TextView(this).apply {
                    this.text = text; textSize = 15f; gravity = Gravity.CENTER
                    setPadding(0, dp(10), 0, dp(10))
                    background = rounded(CARD, 12)
                    setOnClickListener { switchPage(key) }
                }
                navButtons[key] = tv
                nav.addView(tv, LinearLayout.LayoutParams(0, -2, 1f).apply {
                    leftMargin = dp(4); rightMargin = dp(4)
                })
            }
        root.addView(nav)
        setContentView(root)
        switchPage("codes")
    }

    private fun switchPage(page: String) {
        currentPage = page
        navButtons.forEach { (key, tv) ->
            val active = key == page
            tv.setTextColor(if (active) Color.parseColor("#1a1a1a") else MUTED)
            tv.background = rounded(if (active) ACCENT else CARD, 12)
        }
        contentFrame.removeAllViews()
        when (page) {
            "codes" -> contentFrame.addView(buildCodesPage())
            "diary" -> contentFrame.addView(buildDiaryPage())
            "backup" -> contentFrame.addView(buildBackupPage())
            "settings" -> contentFrame.addView(buildSettingsPage())
        }
    }

    private fun doLock() {
        store.lock()
        codeViews.clear()
        showUnlock()
    }

    /* ---------- 验证码页 ---------- */
    private fun buildCodesPage(): View {
        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(14), dp(16), dp(8))
        }
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
        }
        header.addView(label("我的账号", 15f, WHITE).apply {
            typeface = Typeface.DEFAULT_BOLD
            layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
        })
        header.addView(ghostButton("扫码") { pickQrImageFromHeader() })
        header.addView(Space(this).apply { minimumWidth = dp(8) })
        header.addView(accentButton("＋ 添加") { showAccountDialog(null, null) })
        page.addView(header)

        val search = input("搜索账号").apply {
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply {
                topMargin = dp(12); bottomMargin = dp(4)
            }
        }
        codesSearch = search
        search.addTextChangedListener(object : android.text.TextWatcher {
            override fun afterTextChanged(s: android.text.Editable?) { renderCodes() }
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
        })
        page.addView(search)

        val scroll = ScrollView(this)
        val list = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, dp(8), 0, dp(16))
        }
        codesListLayout = list
        scroll.addView(list)
        page.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        renderCodes()
        return page
    }

    private fun renderCodes() {
        val list = codesListLayout ?: return
        val data = store.data ?: return
        val q = codesSearch?.text?.toString()?.trim()?.lowercase().orEmpty()
        list.removeAllViews()
        codeViews.clear()
        val shown = data.accounts.filter {
            q.isEmpty() || it.name.lowercase().contains(q) || it.issuer.lowercase().contains(q)
        }
        if (shown.isEmpty()) {
            list.addView(label(
                if (data.accounts.isEmpty()) "还没有账号\n点右上角「＋ 添加」，或点「扫码」上传二维码图片"
                else "没有匹配的账号", 14f).apply {
                gravity = Gravity.CENTER; setPadding(0, dp(60), 0, 0)
            })
            return
        }
        shown.forEach { acc ->
            list.addView(buildAccountCard(acc))
            list.addView(Space(this).apply { minimumHeight = dp(12) })
        }
    }

    private fun buildAccountCard(acc: Account): View {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            background = rounded(CARD, 14)
            setPadding(dp(18), dp(14), dp(12), dp(14))
            gravity = Gravity.CENTER_VERTICAL
        }
        val left = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val title = when {
            acc.issuer.isNotBlank() && acc.name.isNotBlank() -> "${acc.issuer} · ${acc.name}"
            acc.issuer.isNotBlank() -> acc.issuer
            else -> acc.name
        }
        left.addView(label(title + if (acc.type == "hotp") " · 计数器" else "", 13f))
        val codeTv = TextView(this).apply {
            textSize = 27f; setTextColor(WHITE); typeface = Typeface.MONOSPACE
        }
        left.addView(codeTv)
        card.addView(left, LinearLayout.LayoutParams(0, -2, 1f))

        val right = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.END
        }
        val leftTv = label("", 14f, ACCENT).apply { gravity = Gravity.END }
        right.addView(leftTv)
        val btnRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        if (acc.type == "hotp") {
            btnRow.addView(smallLink("下一个", ACCENT) {
                acc.counter += 1
                store.save()
                updateCodeViews()
                toast("计数器已 +1")
            })
        }
        btnRow.addView(smallLink("二维码") { showQrDialog(acc) })
        btnRow.addView(smallLink("编辑") { showAccountDialog(acc, null) })
        btnRow.addView(smallLink("删除", DANGER) {
            confirmDialog("删除账号", "确定删除「${acc.name.ifBlank { acc.issuer }}」吗？") {
                store.data?.accounts?.remove(acc)
                store.save(); renderCodes()
                toast("已删除")
            }
        })
        right.addView(btnRow)
        card.addView(right)

        codeViews[acc.id] = codeTv to leftTv
        card.setOnClickListener {
            val code = currentCode(acc) ?: return@setOnClickListener
            val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            cm.setPrimaryClip(ClipData.newPlainText("otp", code))
            toast("已复制 $code")
        }
        updateCodeView(acc)
        return card
    }

    private fun currentCode(acc: Account): String? = try {
        if (acc.type == "hotp") Otp.hotpForSecret(acc.secret, acc.counter, acc.digits, acc.algorithm)
        else Otp.codeForSecret(acc.secret, period = acc.period, digits = acc.digits, algorithm = acc.algorithm)
    } catch (e: Exception) { null }

    private fun updateCodeView(acc: Account) {
        val (codeTv, leftTv) = codeViews[acc.id] ?: return
        val code = currentCode(acc)
        codeTv.text = if (code != null) Otp.groupCode(code) else "------"
        if (acc.type == "hotp") {
            leftTv.text = "#${acc.counter}"
            leftTv.setTextColor(MUTED)
        } else {
            val s = Otp.secondsLeft(acc.period)
            leftTv.text = "${s}s"
            leftTv.setTextColor(if (s <= 5) DANGER else ACCENT)
        }
    }

    private fun updateCodeViews() {
        val data = store.data ?: return
        data.accounts.forEach { updateCodeView(it) }
    }

    /* ---------- 添加 / 编辑账号 ---------- */
    private var dlgSecret: EditText? = null
    private var dlgName: EditText? = null
    private var dlgIssuer: EditText? = null
    private var dlgPeriod: EditText? = null
    private var dlgCounter: EditText? = null
    // true=二维码选图是从账号弹窗里发起的（结果填回弹窗）；false=从验证码页「扫码」发起（结果直接开添加弹窗）
    private var qrPickForDialog = false

    private fun cycleButton(labelPrefix: String, values: List<String>, initial: String): Pair<Button, () -> String> {
        var idx = values.indexOf(initial).coerceAtLeast(0)
        lateinit var btn: Button
        btn = ghostButton("") {
            idx = (idx + 1) % values.size
            btn.text = "$labelPrefix：${values[idx]}"
        }
        btn.text = "$labelPrefix：${values[idx]}"
        return btn to { values[idx] }
    }

    private fun showAccountDialog(existing: Account?, prefill: Otp.Parsed?) {
        val inner = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val body = ScrollView(this).apply { addView(inner) }
        fun addToInner(v: View) { inner.addView(v) }
        // otpauth 粘贴解析
        val linkIn = input("粘贴 otpauth:// 链接后点解析")
        addToInner(linkIn)
        val nameIn = input("名称（如 alice@example.com）")
        val issuerIn = input("发行方（如 GitHub，可空）")
        val secretIn = input("密钥（Base32）")
        val periodIn = input("周期秒（默认 30）", number = true)
        val counterIn = input("计数器（HOTP 用，默认 0）", number = true)
        val (typeBtn, typeVal) = cycleButton("类型", listOf("totp", "hotp"),
            existing?.type ?: prefill?.type ?: "totp")
        val (algoBtn, algoVal) = cycleButton("算法", listOf("SHA1", "SHA256", "SHA512"),
            existing?.algorithm ?: prefill?.algorithm ?: "SHA1")
        val (digitsBtn, digitsVal) = cycleButton("位数", listOf("6", "8"),
            (existing?.digits ?: prefill?.digits ?: 6).toString())

        fun fillFromParsed(p: Otp.Parsed) {
            nameIn.setText(p.name); issuerIn.setText(p.issuer); secretIn.setText(p.secret)
            periodIn.setText(p.period.toString()); counterIn.setText(p.counter.toString())
            toast("已解析，请核对后保存")
        }
        val parseRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            addView(ghostButton("解析链接") {
                val p = Otp.parseOtpAuth(linkIn.text.toString())
                if (p == null) toast("链接解析失败") else fillFromParsed(p)
            })
            addView(Space(this@MainActivity).apply { minimumWidth = dp(8) })
            addView(ghostButton("上传二维码图") {
                dlgName = nameIn; dlgIssuer = issuerIn; dlgSecret = secretIn
                dlgPeriod = periodIn; dlgCounter = counterIn
                qrPickForDialog = true
                startActivityForResult(
                    Intent(Intent.ACTION_GET_CONTENT).apply { type = "image/*" }, REQ_QR_IMAGE)
            })
        }
        addToInner(parseRow)
        addToInner(View(this).apply { minimumHeight = dp(10) })
        if (existing != null || prefill != null) {
            val src = existing
            if (src != null) {
                nameIn.setText(src.name); issuerIn.setText(src.issuer); secretIn.setText(src.secret)
                periodIn.setText(src.period.toString()); counterIn.setText(src.counter.toString())
            } else if (prefill != null) fillFromParsed(prefill)
        } else {
            periodIn.setText("30"); counterIn.setText("0")
        }
        addToInner(nameIn); addToInner(issuerIn); addToInner(secretIn)
        addToInner(periodIn); addToInner(counterIn)
        val cycles = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(typeBtn); addView(algoBtn); addView(digitsBtn)
            for (i in 0 until childCount) {
                (getChildAt(i).layoutParams as? LinearLayout.LayoutParams)?.bottomMargin = dp(8)
            }
        }
        addToInner(cycles)

        lateinit var d: AlertDialog
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.END
            setPadding(0, dp(8), 0, 0)
        }
        row.addView(ghostButton("取消") { d.dismiss() })
        row.addView(Space(this@MainActivity).apply { minimumWidth = dp(10) })
        row.addView(accentButton(if (existing != null) "保存" else "添加") {
            val name = nameIn.text.toString().trim()
            val issuer = issuerIn.text.toString().trim()
            val secret = Otp.normalizeSecret(secretIn.text.toString())
            val period = periodIn.text.toString().trim().toIntOrNull() ?: 30
            val counter = counterIn.text.toString().trim().toLongOrNull() ?: 0L
            if (name.isEmpty() && issuer.isEmpty()) { toast("名称和发行方至少填一个"); return@accentButton }
            if (secret.isEmpty() || Otp.base32Decode(secret).isEmpty()) { toast("密钥格式不对"); return@accentButton }
            if (period !in 10..3600) { toast("周期填 10~3600 秒"); return@accentButton }
            val data = store.data ?: return@accentButton
            if (existing != null) {
                existing.name = name; existing.issuer = issuer; existing.secret = secret
                existing.period = period; existing.counter = counter
                existing.type = typeVal(); existing.algorithm = algoVal()
                existing.digits = digitsVal().toInt()
                toast("已保存")
            } else {
                data.accounts.add(Account(
                    name = name, issuer = issuer, secret = secret,
                    algorithm = algoVal(), digits = digitsVal().toInt(),
                    period = period, type = typeVal(), counter = counter))
                toast("已添加")
            }
            store.save()
            d.dismiss()
            if (currentPage == "codes") renderCodes()
        })
        addToInner(row)
        d = dialogBox(if (existing != null) "编辑账号" else "添加账号", body)
        d.show()
    }

    /* ---------- 扫码添加（只走上传二维码图片，不用摄像头） ---------- */
    private fun pickQrImageFromHeader() {
        qrPickForDialog = false
        dlgName = null; dlgIssuer = null; dlgSecret = null
        dlgPeriod = null; dlgCounter = null
        startActivityForResult(
            Intent(Intent.ACTION_GET_CONTENT).apply { type = "image/*" }, REQ_QR_IMAGE)
    }

    /* ---------- 账号二维码 ---------- */
    private fun showQrDialog(acc: Account) {
        val link = Otp.buildOtpAuth(acc.type, acc.name, acc.issuer, acc.secret,
            acc.algorithm, acc.digits, acc.period, acc.counter)
        val body = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL
        }
        val size = dp(240)
        val bmp = try {
            val matrix = QRCodeWriter().encode(link, BarcodeFormat.QR_CODE, size, size)
            val pixels = IntArray(size * size)
            for (y in 0 until size) for (x in 0 until size) {
                pixels[y * size + x] = if (matrix.get(x, y)) Color.BLACK else Color.WHITE
            }
            Bitmap.createBitmap(size, size, Bitmap.Config.RGB_565).apply {
                setPixels(pixels, 0, size, 0, 0, size, size)
            }
        } catch (e: Exception) { null }
        if (bmp != null) {
            body.addView(ImageView(this).apply {
                setImageBitmap(bmp)
                background = rounded(Color.WHITE, 12)
                setPadding(dp(10), dp(10), dp(10), dp(10))
                layoutParams = LinearLayout.LayoutParams(size + dp(20), size + dp(20))
            })
        }
        body.addView(label("用另一台设备的验证器扫这个码即可添加", 12f).apply {
            setPadding(0, dp(12), 0, dp(6)); gravity = Gravity.CENTER
        })
        body.addView(ghostButton("复制链接") {
            val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            cm.setPrimaryClip(ClipData.newPlainText("otpauth", link))
            toast("已复制 otpauth 链接")
        })
        dialogBox("账号二维码", body).show()
    }

    /* ---------- 日记页 ---------- */
    private fun buildDiaryPage(): View {
        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(14), dp(16), dp(8))
        }
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
        }
        header.addView(label("我的日记", 15f, WHITE).apply {
            typeface = Typeface.DEFAULT_BOLD
            layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
        })
        header.addView(accentButton("＋ 写日记") { showDiaryDialog(null) })
        page.addView(header)
        val search = input("搜索日记").apply {
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply {
                topMargin = dp(12); bottomMargin = dp(4)
            }
        }
        diarySearch = search
        search.addTextChangedListener(object : android.text.TextWatcher {
            override fun afterTextChanged(s: android.text.Editable?) { renderDiary() }
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
        })
        page.addView(search)
        val scroll = ScrollView(this)
        val list = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, dp(8), 0, dp(16))
        }
        diaryListLayout = list
        scroll.addView(list)
        page.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        renderDiary()
        return page
    }

    private fun renderDiary() {
        val list = diaryListLayout ?: return
        val data = store.data ?: return
        val q = diarySearch?.text?.toString()?.trim()?.lowercase().orEmpty()
        list.removeAllViews()
        val shown = data.diary
            .filter { q.isEmpty() || it.title.lowercase().contains(q) ||
                it.body.lowercase().contains(q) || it.date.contains(q) }
            .sortedWith(compareByDescending<DiaryEntry> { it.date }
                .thenByDescending { it.createdAt })
        if (shown.isEmpty()) {
            list.addView(label(
                if (data.diary.isEmpty()) "还没有日记\n点右上角「＋ 写日记」记第一篇"
                else "没有匹配的日记", 14f).apply {
                gravity = Gravity.CENTER; setPadding(0, dp(60), 0, 0)
            })
            return
        }
        shown.forEach { e ->
            val card = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                background = rounded(CARD, 14)
                setPadding(dp(18), dp(14), dp(18), dp(14))
                isClickable = true
                setOnClickListener { showDiaryDialog(e) }
            }
            val meta = StringBuilder(e.date)
            if (e.mood.isNotBlank()) meta.append(" · ").append(e.mood)
            card.addView(label(meta.toString(), 12f, ACCENT))
            card.addView(TextView(this).apply {
                text = e.title.ifBlank { "(无标题)" }; textSize = 16f
                setTextColor(WHITE); typeface = Typeface.DEFAULT_BOLD
                setPadding(0, dp(4), 0, dp(2))
            })
            if (e.body.isNotBlank()) {
                card.addView(label(e.body.replace("\n", " ").take(80), 13f))
            }
            list.addView(card)
            list.addView(Space(this).apply { minimumHeight = dp(12) })
        }
    }

    private fun showDiaryDialog(existing: DiaryEntry?) {
        val body = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val today = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
        val dateIn = input("日期 yyyy-MM-dd").apply { setText(existing?.date ?: today) }
        val titleIn = input("标题").apply { setText(existing?.title ?: "") }
        val moodIn = input("心情（可空，如：开心）").apply { setText(existing?.mood ?: "") }
        val bodyIn = input("正文").apply {
            setText(existing?.body ?: "")
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE
            minLines = 5; gravity = Gravity.TOP
        }
        body.addView(dateIn); body.addView(titleIn); body.addView(moodIn); body.addView(bodyIn)
        lateinit var d: AlertDialog
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.END
        }
        if (existing != null) {
            row.addView(smallLink("删除", DANGER) {
                d.dismiss()
                confirmDialog("删除日记", "确定删除这篇日记吗？") {
                    store.data?.diary?.remove(existing)
                    store.save(); renderDiary()
                    toast("已删除")
                }
            })
            row.addView(Space(this@MainActivity).apply { minimumWidth = dp(6) })
        }
        row.addView(ghostButton("取消") { d.dismiss() })
        row.addView(Space(this@MainActivity).apply { minimumWidth = dp(10) })
        row.addView(accentButton("保存") {
            val date = dateIn.text.toString().trim()
            if (!Regex("\\d{4}-\\d{2}-\\d{2}").matches(date)) { toast("日期格式要 yyyy-MM-dd"); return@accentButton }
            val data = store.data ?: return@accentButton
            val now = System.currentTimeMillis()
            if (existing != null) {
                existing.date = date; existing.title = titleIn.text.toString().trim()
                existing.mood = moodIn.text.toString().trim()
                existing.body = bodyIn.text.toString()
                existing.updatedAt = now
            } else {
                data.diary.add(DiaryEntry(
                    date = date, title = titleIn.text.toString().trim(),
                    mood = moodIn.text.toString().trim(), body = bodyIn.text.toString(),
                    createdAt = now, updatedAt = now))
            }
            store.save()
            d.dismiss(); renderDiary()
            toast("已保存")
        })
        body.addView(row)
        d = dialogBox(if (existing != null) "编辑日记" else "写日记", body)
        d.show()
    }

    /* ---------- 备份页 ---------- */
    private var pendingExportPassword: String? = null

    private fun buildBackupPage(): View {
        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(14), dp(16), dp(8))
        }
        page.addView(label("备份与恢复", 15f, WHITE).apply { typeface = Typeface.DEFAULT_BOLD })
        page.addView(label(
            "备份文件是加密的（PBKDF2 + AES-256-GCM），与桌面版、浏览器插件版完全互通：" +
            "这里导出的能在电脑上打开，电脑导出的也能在这里导入。", 13f).apply {
            setPadding(0, dp(10), 0, dp(20))
        })
        page.addView(accentButton("导出备份") { askExportPassword() }.apply {
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(14) }
        })
        page.addView(ghostButton("导入备份") {
            startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "*/*"
            }, REQ_IMPORT)
        }.apply { layoutParams = LinearLayout.LayoutParams(-1, -2) })
        page.addView(label("导入会整体替换当前的账号和日记，导入前请确认手里这份备份是对的。", 12f).apply {
            setPadding(0, dp(16), 0, 0)
        })
        return page
    }

    private fun askExportPassword() {
        val body = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val pw = input("给备份设密码（解开时要用）", password = true)
        body.addView(pw)
        body.addView(label("一般就填你的主密码，省得记两个。", 12f))
        lateinit var d: AlertDialog
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.END
            setPadding(0, dp(10), 0, 0)
        }
        row.addView(ghostButton("取消") { d.dismiss() })
        row.addView(Space(this@MainActivity).apply { minimumWidth = dp(10) })
        row.addView(accentButton("下一步") {
            val p = pw.text.toString()
            if (p.isEmpty()) { toast("密码不能为空"); return@accentButton }
            pendingExportPassword = p
            d.dismiss()
            startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "application/json"
                putExtra(Intent.EXTRA_TITLE, "yousj-otp-backup.json")
            }, REQ_EXPORT)
        })
        body.addView(row)
        d = dialogBox("导出备份", body)
        d.show()
    }

    private fun askImportPassword(envJson: String) {
        val body = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val pw = input("输入这份备份的密码", password = true)
        body.addView(pw)
        lateinit var d: AlertDialog
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.END
            setPadding(0, dp(10), 0, 0)
        }
        row.addView(ghostButton("取消") { d.dismiss() })
        row.addView(Space(this@MainActivity).apply { minimumWidth = dp(10) })
        row.addView(accentButton("解开") {
            val p = pw.text.toString()
            val imported = try {
                Envelope.decrypt(JSONObject(envJson), p).first
            } catch (e: Exception) {
                toast("解不开：密码不对或文件已损坏", true); return@accentButton
            }
            d.dismiss()
            confirmDialog("确认导入",
                "将导入 ${imported.accounts.size} 个账号、${imported.diary.size} 篇日记，" +
                "并替换当前全部数据，继续吗？") {
                val data = store.data ?: return@confirmDialog
                data.accounts.clear(); data.accounts.addAll(imported.accounts)
                data.diary.clear(); data.diary.addAll(imported.diary)
                data.autoLockMinutes = imported.autoLockMinutes
                store.save()
                toast("导入完成")
                switchPage("codes")
            }
        })
        body.addView(row)
        d = dialogBox("导入备份", body)
        d.show()
    }

    /* ---------- 设置页 ---------- */
    private fun buildSettingsPage(): View {
        val data = store.data
        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(14), dp(16), dp(8))
        }
        val scroll = ScrollView(this)
        val inner = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        scroll.addView(inner)
        page.addView(scroll, LinearLayout.LayoutParams(-1, -1))

        inner.addView(label("修改主密码", 15f, WHITE).apply {
            typeface = Typeface.DEFAULT_BOLD; setPadding(0, 0, 0, dp(10))
        })
        val oldPw = input("当前密码", password = true)
        val newPw = input("新密码", password = true)
        val newPw2 = input("再输一次新密码", password = true)
        inner.addView(oldPw); inner.addView(newPw); inner.addView(newPw2)
        inner.addView(accentButton("修改密码") {
            val n = newPw.text.toString()
            if (n.length < 4) { toast("新密码至少 4 位"); return@accentButton }
            if (n != newPw2.text.toString()) { toast("两次新密码不一致"); return@accentButton }
            try {
                store.changePassword(oldPw.text.toString(), n)
                toast("密码已修改")
                oldPw.text.clear(); newPw.text.clear(); newPw2.text.clear()
            } catch (e: Exception) { toast(e.message ?: "修改失败") }
        }.apply { layoutParams = LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(24) } })

        inner.addView(label("自动锁定", 15f, WHITE).apply {
            typeface = Typeface.DEFAULT_BOLD; setPadding(0, 0, 0, dp(10))
        })
        val lockIn = input("无操作多少分钟后锁定（0 = 不自动锁）", number = true).apply {
            setText((data?.autoLockMinutes ?: 5).toString())
        }
        inner.addView(lockIn)
        inner.addView(ghostButton("保存自动锁定设置") {
            val v = lockIn.text.toString().trim().toIntOrNull()
            if (v == null || v < 0 || v > 1440) { toast("填 0~1440 的分钟数"); return@ghostButton }
            store.data?.autoLockMinutes = v
            store.save()
            toast("已保存")
        }.apply { layoutParams = LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(24) } })

        inner.addView(ghostButton("立即锁定") { doLock() }.apply {
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(24) }
        })
        inner.addView(label("Yousj OTP 安卓版 2.1.0\n包名 cc.yousj.otp\n数据只保存在本机加密库中，不联网。", 12f))
        return page
    }

    /* ---------- 文件 / 二维码图片回调 ---------- */
    override fun onActivityResult(req: Int, res: Int, data: Intent?) {
        super.onActivityResult(req, res, data)
        if (res != RESULT_OK) return
        when (req) {
            REQ_QR_IMAGE -> {
                val uri = data?.data ?: return
                val forDialog = qrPickForDialog
                qrPickForDialog = false
                try {
                    val stream = contentResolver.openInputStream(uri)!!
                    val bmp = BitmapFactory.decodeStream(stream)
                    stream.close()
                    val w = bmp.width; val h = bmp.height
                    val pixels = IntArray(w * h)
                    bmp.getPixels(pixels, 0, w, 0, 0, w, h)
                    val result = QRCodeReader().decode(
                        BinaryBitmap(HybridBinarizer(RGBLuminanceSource(w, h, pixels))))
                    val p = Otp.parseOtpAuth(result.text)
                    if (p == null) { toast("不是有效的 OTP 二维码", true); return }
                    if (forDialog && dlgName != null) {
                        dlgName?.setText(p.name); dlgIssuer?.setText(p.issuer)
                        dlgSecret?.setText(p.secret); dlgPeriod?.setText(p.period.toString())
                        dlgCounter?.setText(p.counter.toString())
                        toast("已填入，检查后点保存")
                    } else {
                        showAccountDialog(null, p)
                    }
                } catch (e: Exception) {
                    toast("识别失败：${e.message}", true)
                }
            }
            REQ_EXPORT -> {
                val uri = data?.data ?: return
                val pw = pendingExportPassword ?: return
                pendingExportPassword = null
                val vaultData = store.data ?: return
                try {
                    val env = Envelope.encrypt(vaultData, pw)
                    contentResolver.openOutputStream(uri)?.use {
                        it.write(env.toString(2).toByteArray(Charsets.UTF_8))
                    }
                    toast("备份已导出")
                } catch (e: Exception) { toast("导出失败：${e.message}", true) }
            }
            REQ_IMPORT -> {
                val uri = data?.data ?: return
                try {
                    val text = contentResolver.openInputStream(uri)?.use {
                        it.readBytes().toString(Charsets.UTF_8)
                    } ?: return
                    askImportPassword(text)
                } catch (e: Exception) { toast("读文件失败：${e.message}", true) }
            }
        }
    }

    /* ---------- 计时：刷新码 + 自动锁定 ---------- */
    private fun tick() {
        if (store.isUnlocked()) {
            val data = store.data
            val mins = data?.autoLockMinutes ?: 5
            if (mins > 0 && System.currentTimeMillis() - lastActiveMs > mins * 60_000L) {
                doLock()
                toast("已自动锁定")
            } else if (currentPage == "codes") {
                updateCodeViews()
            }
        }
        handler.postDelayed({ tick() }, 1000)
    }

    override fun dispatchTouchEvent(ev: MotionEvent?): Boolean {
        if (ev?.action == MotionEvent.ACTION_DOWN) lastActiveMs = System.currentTimeMillis()
        return super.dispatchTouchEvent(ev)
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    companion object {
        private const val REQ_QR_IMAGE = 1001
        private const val REQ_EXPORT = 1003
        private const val REQ_IMPORT = 1004
    }
}
