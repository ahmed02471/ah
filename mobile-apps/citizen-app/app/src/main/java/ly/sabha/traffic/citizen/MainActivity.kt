package ly.sabha.traffic.citizen

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout

/**
 * تطبيق المواطن — غلاف WebView بسيط حول موقع نظام مرور سبها (Railway).
 * يدعم: كاميرا (لمسح QR إن وُجد) + رفع الملفات (صور البلاغات/العقود) + السحب للتحديث + زر الرجوع.
 */
class MainActivity : AppCompatActivity() {

    // غيّر هذا الرابط إذا تغيّر دومين Railway مستقبلاً
    private val startUrl = "https://ah-production-0ab2.up.railway.app/citizen"

    private lateinit var webView: WebView
    private lateinit var swipeRefresh: SwipeRefreshLayout

    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var pendingPermissionRequest: PermissionRequest? = null

    private val fileChooserLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val data = result.data
            val uris: Array<Uri>? = if (result.resultCode == RESULT_OK && data != null) {
                val uri = data.data
                if (uri != null) arrayOf(uri) else null
            } else null
            filePathCallback?.onReceiveValue(uris)
            filePathCallback = null
        }

    private val cameraPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            val req = pendingPermissionRequest
            pendingPermissionRequest = null
            if (req == null) return@registerForActivityResult
            if (granted) req.grant(req.resources) else req.deny()
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webview)
        swipeRefresh = findViewById(R.id.swipeRefresh)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = true
            useWideViewPort = true
            loadWithOverviewMode = true
        }

        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                swipeRefresh.isRefreshing = false
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            // طلب صلاحية الكاميرا (لمسح QR داخل الصفحة عبر getUserMedia)
            override fun onPermissionRequest(request: PermissionRequest) {
                val needsCamera = request.resources.any { it == PermissionRequest.RESOURCE_VIDEO_CAPTURE }
                if (!needsCamera) { request.deny(); return }

                if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.CAMERA)
                    == PackageManager.PERMISSION_GRANTED
                ) {
                    request.grant(request.resources)
                } else {
                    pendingPermissionRequest = request
                    cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
                }
            }

            // اختيار ملف (صورة البلاغ / عقد البيع) من الجهاز
            override fun onShowFileChooser(
                view: WebView?,
                callback: ValueCallback<Array<Uri>>?,
                params: FileChooserParams?
            ): Boolean {
                filePathCallback = callback
                val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = params?.acceptTypes?.firstOrNull { it.isNotBlank() } ?: "image/*"
                }
                fileChooserLauncher.launch(Intent.createChooser(intent, "اختر صورة"))
                return true
            }
        }

        swipeRefresh.setOnRefreshListener { webView.reload() }

        if (savedInstanceState == null) {
            webView.loadUrl(startUrl)
        }
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }
}
