package cc.yousj.otp.ui

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.hardware.Camera
import android.os.Bundle
import android.view.Gravity
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.widget.FrameLayout
import android.widget.TextView
import android.widget.Toast
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader
import java.util.concurrent.atomic.AtomicBoolean

/** 相机扫码（ZXing core 离线解码），扫到后把原文通过 result 返回 */
class ScanActivity : Activity(), SurfaceHolder.Callback {

    private var camera: Camera? = null
    private lateinit var preview: SurfaceView
    private val decoding = AtomicBoolean(false)
    private val reader = QRCodeReader()
    private val hints = mapOf(DecodeHintType.TRY_HARDER to true)
    @Volatile private var done = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = FrameLayout(this)
        root.setBackgroundColor(Color.parseColor("#1a1a1a"))
        preview = SurfaceView(this)
        root.addView(preview, FrameLayout.LayoutParams(-1, -1))
        val tip = TextView(this).apply {
            text = "将二维码放入取景框内"
            setTextColor(Color.WHITE)
            textSize = 15f
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#222222"))
            setPadding(0, 36, 0, 36)
        }
        root.addView(tip, FrameLayout.LayoutParams(-1, -2, Gravity.TOP))
        setContentView(root)
        preview.holder.addCallback(this)
    }

    override fun surfaceCreated(holder: SurfaceHolder) {
        try {
            val cam = Camera.open()
            camera = cam
            cam.setDisplayOrientation(90)
            val params = cam.parameters
            // 选一个不大于 1280 宽的预览尺寸，解码够用又不卡
            val size = params.supportedPreviewSizes
                .filter { it.width <= 1280 }
                .maxByOrNull { it.width * it.height }
                ?: params.supportedPreviewSizes.first()
            params.setPreviewSize(size.width, size.height)
            if (params.supportedFocusModes.contains(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE)) {
                params.focusMode = Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE
            }
            cam.parameters = params
            cam.setPreviewDisplay(holder)
            cam.setPreviewCallback { data, c -> onPreviewFrame(data, c) }
            cam.startPreview()
        } catch (e: Exception) {
            Toast.makeText(this, "相机打开失败：${e.message}", Toast.LENGTH_LONG).show()
            finish()
        }
    }

    private fun onPreviewFrame(data: ByteArray, cam: Camera) {
        if (done || !decoding.compareAndSet(false, true)) return
        Thread {
            try {
                val size = cam.parameters.previewSize
                val text = tryDecode(data, size.width, size.height, false)
                    ?: tryDecode(data, size.width, size.height, true)
                if (text != null && !done) {
                    done = true
                    runOnUiThread {
                        setResult(RESULT_OK, Intent().putExtra(EXTRA_QR_TEXT, text))
                        finish()
                    }
                }
            } catch (e: Exception) {
                // 本帧解不出很正常，忽略
            } finally {
                decoding.set(false)
            }
        }.start()
    }

    private fun tryDecode(data: ByteArray, w: Int, h: Int, rotate: Boolean): String? {
        val src = if (!rotate) {
            PlanarYUVLuminanceSource(data, w, h, 0, 0, w, h, false)
        } else {
            // 传感器数据顺时针转 90° 后再解（竖屏取景常见）
            val rotated = ByteArray(data.size)
            for (x in 0 until w) {
                for (y in 0 until h) {
                    rotated[x * h + h - y - 1] = data[y * w + x]
                }
            }
            PlanarYUVLuminanceSource(rotated, h, w, 0, 0, h, w, false)
        }
        return try {
            reader.decode(BinaryBitmap(HybridBinarizer(src)), hints).text
        } catch (e: Exception) {
            try { reader.decode(BinaryBitmap(HybridBinarizer(src.invert())), hints).text }
            catch (e2: Exception) { null }
        }
    }

    override fun surfaceChanged(holder: SurfaceHolder, format: Int, w: Int, h: Int) {}
    override fun surfaceDestroyed(holder: SurfaceHolder) { releaseCamera() }

    override fun onPause() {
        releaseCamera()
        super.onPause()
    }

    private fun releaseCamera() {
        try {
            camera?.setPreviewCallback(null)
            camera?.stopPreview()
            camera?.release()
        } catch (e: Exception) { }
        camera = null
    }

    companion object {
        const val EXTRA_QR_TEXT = "qr_text"
    }
}
