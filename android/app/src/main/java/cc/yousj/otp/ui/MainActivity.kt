package cc.yousj.otp.ui

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.widget.*
import cc.yousj.otp.totp.Totp
import com.google.zxing.BinaryBitmap
import com.google.zxing.RGBLuminanceSource
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader
import org.json.JSONArray
import org.json.JSONObject

class MainActivity : Activity() {

    private val handler = Handler(Looper.getMainLooper())
    private lateinit var listLayout: LinearLayout
    private val PREF = "otp_accounts"

    data class Account(val name: String, val secret: String, val period: Int = Totp.PERIOD)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildUI()
        tick()
    }

    private fun buildUI() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#1a1a1a"))
        }
        // 标题栏
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(Color.parseColor("#222222"))
            setPadding(28, 28, 28, 28)
            gravity = Gravity.CENTER_VERTICAL
        }
        val title = TextView(this).apply {
            text = "Yousj OTP"
            textSize = 18f
            setTextColor(Color.parseColor("#f5a623"))
            layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
        }
        val addBtn = Button(this).apply {
            text = "+"
            textSize = 18f
            setOnClickListener { showAddDialog() }
        }
        bar.addView(title); bar.addView(addBtn)
        root.addView(bar)

        val scroll = ScrollView(this)
        listLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(16, 16, 16, 16)
        }
        scroll.addView(listLayout)
        root.addView(scroll, LinearLayout.LayoutParams(-1, -1, 1f))
        setContentView(root)
    }

    /* ---------- 账号存取 ---------- */
    private fun loadAccounts(): MutableList<Account> {
        val s = getSharedPreferences(PREF, Context.MODE_PRIVATE).getString("list", "[]")!!
        val arr = JSONArray(s)
        return MutableList(arr.length()) { i ->
            val o = arr.getJSONObject(i)
            Account(o.getString("name"), o.getString("secret"),
                o.optInt("period", Totp.PERIOD).takeIf { it in 10..3600 } ?: Totp.PERIOD)
        }
    }
    private fun saveAccounts(a: List<Account>) {
        val arr = JSONArray()
        a.forEach { arr.put(JSONObject().put("name", it.name).put("secret", it.secret).put("period", it.period)) }
        getSharedPreferences(PREF, Context.MODE_PRIVATE).edit().putString("list", arr.toString()).apply()
    }

    /* ---------- 刷新列表 ---------- */
    private fun tick() {
        renderList()
        handler.postDelayed({ tick() }, 1000)
    }

    private fun renderList() {
        val accounts = loadAccounts()
        listLayout.removeAllViews()
        if (accounts.isEmpty()) {
            listLayout.addView(TextView(this).apply {
                text = "还没有账号\n点右上角 + 添加\n支持上传二维码图片自动解析"
                setTextColor(Color.GRAY)
                gravity = Gravity.CENTER
                setPadding(0, 80, 0, 0)
                textSize = 14f
            })
            return
        }
        accounts.forEachIndexed { idx, acc ->
            val code = try { Totp.generate(acc.secret, acc.period) } catch (e: Exception) { "------" }
            val sLeft = Totp.secondsLeft(acc.period)
            val card = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                setBackgroundColor(Color.parseColor("#262626"))
                setPadding(24, 20, 24, 20)
                gravity = Gravity.CENTER_VERTICAL
                isClickable = true
                setOnClickListener {
                    val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    cm.setPrimaryClip(ClipData.newPlainText("otp", code))
                    Toast.makeText(this@MainActivity, "已复制 $code", Toast.LENGTH_SHORT).show()
                }
            }
            val left = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
            left.addView(TextView(this).apply {
                text = if (acc.period != 15) "${acc.name} · ${acc.period}s" else acc.name
                setTextColor(Color.parseColor("#aaaaaa")); textSize = 13f
            })
            left.addView(TextView(this).apply {
                text = "${code.substring(0, 3)} ${code.substring(3)}"
                setTextColor(Color.WHITE); textSize = 26f
                typeface = android.graphics.Typeface.MONOSPACE
            })
            val lp = LinearLayout.LayoutParams(0, -2, 1f)
            card.addView(left, lp)
            card.addView(TextView(this).apply {
                text = "${sLeft}s"
                setTextColor(if (sLeft <= 5) Color.parseColor("#ff6b6b") else Color.parseColor("#f5a623"))
                textSize = 14f
                setPadding(12, 0, 12, 0)
            })
            val edt = TextView(this).apply {
                text = "✎"; textSize = 18f; setTextColor(Color.GRAY); setPadding(12, 0, 0, 0)
                setOnClickListener { showAddDialog(editIndex = idx) }
            }
            card.addView(edt)
            val del = TextView(this).apply {
                text = "×"; textSize = 22f; setTextColor(Color.GRAY); setPadding(12, 0, 0, 0)
                setOnClickListener {
                    val a2 = loadAccounts().toMutableList()
                    a2.removeAt(idx); saveAccounts(a2); renderList()
                    Toast.makeText(this@MainActivity, "已删除", Toast.LENGTH_SHORT).show()
                }
            }
            card.addView(del)
            listLayout.addView(card)
            val sp = Space(this); sp.minimumHeight = 12
            listLayout.addView(sp)
        }
    }

    /* ---------- 添加 / 编辑账号 ---------- */
    private fun showAddDialog(editIndex: Int = -1) {
        val existing = if (editIndex >= 0) loadAccounts().getOrNull(editIndex) else null
        val dlg = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(40, 40, 40, 40)
        }
        val nameIn = EditText(this).apply {
            hint = "名字（如：GitHub）"
            setText(existing?.name ?: "")
        }
        val secretIn = EditText(this).apply {
            hint = "密钥（Base32，可手动填）"
            setText(existing?.secret ?: "")
        }
        val periodIn = EditText(this).apply {
            hint = "时长（秒，默认 15，可改）"
            inputType = android.text.InputType.TYPE_CLASS_NUMBER
            setText((existing?.period ?: 15).toString())
        }
        val btnManual = Button(this).apply { text = if (existing != null) "保存修改" else "手动添加" }
        val btnQR = Button(this).apply { text = "上传二维码图片" }
        dlg.addView(nameIn); dlg.addView(secretIn); dlg.addView(periodIn)
        dlg.addView(btnManual); dlg.addView(btnQR)

        val d = android.app.AlertDialog.Builder(this)
            .setTitle(if (existing != null) "编辑账号" else "添加账号")
            .setView(dlg).create()

        btnManual.setOnClickListener {
            val name = nameIn.text.toString().trim()
            val secret = secretIn.text.toString().trim().replace("\\s".toRegex(), "")
            val periodRaw = periodIn.text.toString().trim()
            // 宽松解析：提取开头的数字（如 "30秒" 也能认出 30）
            val period = Regex("^\\d+").find(periodRaw)?.value?.toIntOrNull() ?: 15
            if (name.isEmpty() || secret.isEmpty()) {
                Toast.makeText(this, "名字和密钥都要填", Toast.LENGTH_SHORT).show(); return@setOnClickListener
            }
            if (period !in 10..3600) {
                Toast.makeText(this, "时长填 10~3600 的整数秒", Toast.LENGTH_SHORT).show(); return@setOnClickListener
            }
            try { Totp.generate(secret, period) } catch (e: Exception) {
                Toast.makeText(this, "密钥格式不对", Toast.LENGTH_SHORT).show(); return@setOnClickListener
            }
            val a = loadAccounts()
            if (editIndex >= 0 && editIndex < a.size) {
                a[editIndex] = Account(name, secret, period)
                Toast.makeText(this, "已保存修改", Toast.LENGTH_SHORT).show()
            } else {
                a.add(Account(name, secret, period))
                Toast.makeText(this, "已添加", Toast.LENGTH_SHORT).show()
            }
            saveAccounts(a)
            d.dismiss(); renderList()
        }
        btnQR.setOnClickListener {
            // 不关闭对话框，选图回来后只回填字段
            pendingNameIn = nameIn; pendingSecretIn = secretIn
            pendingPeriodIn = periodIn; pendingDialog = d
            startActivityForResult(
                Intent(Intent.ACTION_GET_CONTENT).apply { type = "image/*" }, 1001)
        }
        d.show()
    }

    private var pendingNameIn: EditText? = null
    private var pendingSecretIn: EditText? = null
    private var pendingPeriodIn: EditText? = null
    private var pendingDialog: android.app.AlertDialog? = null

    override fun onActivityResult(req: Int, res: Int, data: Intent?) {
        super.onActivityResult(req, res, data)
        if (req == 1001 && res == RESULT_OK) {
            val uri = data?.data ?: return
            try {
                val stream = contentResolver.openInputStream(uri)!!
                val bmp = BitmapFactory.decodeStream(stream)
                stream.close()
                val w = bmp.width; val h = bmp.height
                val pixels = IntArray(w * h)
                bmp.getPixels(pixels, 0, w, 0, 0, w, h)
                val src = RGBLuminanceSource(w, h, pixels)
                val result = QRCodeReader().decode(BinaryBitmap(HybridBinarizer(src)))
                val parsed = Totp.parseOtpAuth(result.text)
                if (parsed == null) {
                    Toast.makeText(this, "不是有效的 OTP 二维码", Toast.LENGTH_LONG).show()
                    return
                }
                // 只回填到对话框，不直接保存，等用户点「手动添加」
                pendingNameIn?.setText(parsed.first)
                pendingSecretIn?.setText(parsed.second)
                pendingPeriodIn?.setText(parsed.third.toString())
                Toast.makeText(this, "已填入，检查后点「手动添加」保存", Toast.LENGTH_SHORT).show()
            } catch (e: Exception) {
                Toast.makeText(this, "识别失败：${e.message}", Toast.LENGTH_LONG).show()
            }
        }
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        super.onDestroy()
    }
}
