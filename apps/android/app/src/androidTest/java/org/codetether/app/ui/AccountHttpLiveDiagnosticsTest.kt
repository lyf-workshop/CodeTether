package org.codetether.app.ui

import android.os.SystemClock
import android.graphics.Rect
import android.view.accessibility.AccessibilityNodeInfo
import androidx.lifecycle.ViewModelProvider
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.Closeable
import java.lang.reflect.Field
import java.security.MessageDigest
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import okhttp3.Call
import okhttp3.EventListener
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Interceptor
import okhttp3.Response
import org.codetether.app.BuildConfig
import org.codetether.app.MainActivity
import org.json.JSONObject
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Observes requests initiated through the real login UI. No request is initiated by this test. */
@RunWith(AndroidJUnit4::class)
class AccountHttpLiveDiagnosticsTest {
    private val accessibilityLock = Any()

    @Test
    fun observeLoginHttpStatusUntilTheControllingPcFinishes() {
        val arguments = InstrumentationRegistry.getArguments()
        assumeTrue(arguments.getString("t1aObserveLoginHttp") == "true")
        val report = LiveAcceptanceReport()
        report.flag("passed", false)
        report.flag("observer_restored", false)
        var stage = 0L
        try {
            val expected = requireNotNull(arguments.getString("t1aExpectedEmailSha256"))
            require(expected.matches(Regex("[a-f0-9]{64}"))) { "A normalized expected-email digest is required" }
            val expectedBytes = expected.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
            val timeout = (arguments.getString("t1aTimeoutSeconds")?.toLongOrNull() ?: 600L).also {
                require(it in 30L..900L) { "The diagnostic timeout is outside its supported range" }
            } * 1_000L
            val verificationResponses = AtomicLong()
            val otpResponses = AtomicLong()
            val origin = BuildConfig.SUPABASE_URL.toHttpUrl()
            fun operation(response: Response): String? {
                val url = response.request.url
                if (url.scheme != origin.scheme || url.host != origin.host || url.port != origin.port ||
                    response.request.method != "POST"
                ) return null
                return when (url.encodedPath) {
                    "/auth/v1/otp" -> "otp"
                    "/auth/v1/verify" -> "verify"
                    else -> null
                }
            }
            val listener = object : EventListener() {
                override fun responseHeadersEnd(call: Call, response: Response) {
                    when (operation(response)) {
                        "otp" -> {
                            report.number("otp_http_status", response.code.toLong())
                            report.number("otp_http_responses", otpResponses.incrementAndGet())
                        }
                        "verify" -> {
                            report.number("verify_http_status", response.code.toLong())
                            report.number("verify_http_responses", verificationResponses.incrementAndGet())
                        }
                        else -> return
                    }
                    report.publish()
                }
            }
            val classifyError = Interceptor { chain ->
                val response = chain.proceed(chain.request())
                val operation = operation(response)
                if (operation != null && !response.isSuccessful) {
                    val kind = loginErrorKind(response)
                    report.number("${operation}_error_kind", kind.toLong())
                    report.flag("${operation}_error_otp_expired", kind == 1)
                    report.publish()
                }
                response
            }
            stage = 1
            ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                lateinit var controller: TabletController
                lateinit var observation: ClientObservation
                scenario.onActivity { activity ->
                    controller = ViewModelProvider(activity)[TabletController::class.java]
                    observation = ClientObservation.install(controller, listener, classifyError)
                }
                try {
                    LiveAcceptanceControl(report) { command ->
                        if (command != "SUBMIT_LOGIN") null else {
                            val state = controller.state.value
                            val clicked = state.page == TabletPage.SignIn && state.otpEmail != null &&
                                !state.busy && submitLoginButton()
                            report.flag("login_button_click_accepted", clicked)
                            JSONObject().put("ok", clicked)
                        }
                    }.use { control ->
                        report.number("control_port", control.port.toLong())
                        report.flag("diagnostic_ready", true)
                        report.publish()
                        stage = 2
                        val matched = AtomicBoolean()
                        runBlocking {
                            val deadline = SystemClock.elapsedRealtime() + timeout
                            while (!control.finished.get()) {
                                check(SystemClock.elapsedRealtime() < deadline) { "The login diagnostic timed out" }
                                val state = controller.state.value
                                val emailMatches = state.otpEmail?.let { email ->
                                    MessageDigest.isEqual(
                                        expectedBytes,
                                        MessageDigest.getInstance("SHA-256").digest(
                                            email.trim().lowercase(Locale.ROOT).toByteArray(Charsets.UTF_8),
                                        ),
                                    )
                                } ?: false
                                if (emailMatches) matched.set(true)
                                report.flag("current_otp_email_present", state.otpEmail != null)
                                report.flag("current_otp_email_matches_expected", emailMatches)
                                report.flag("otp_email_matched_expected_seen", matched.get())
                                report.flag("ui_busy", state.busy)
                                report.flag("ui_error_present", state.error != null)
                                report.flag("profile_present", state.profile != null)
                                if (state.page == TabletPage.SignIn && state.otpEmail != null) {
                                    val field = passwordFieldCounts()
                                    report.flag("code_field_accessible", field != null)
                                    if (field != null) {
                                        report.number("code_field_character_count", field.characters.toLong())
                                        report.number("code_field_digit_count", field.digits.toLong())
                                        report.flag("code_field_text_masked", field.digits < field.characters)
                                        report.number("code_field_left", field.bounds.left.toLong())
                                        report.number("code_field_top", field.bounds.top.toLong())
                                        report.number("code_field_right", field.bounds.right.toLong())
                                        report.number("code_field_bottom", field.bounds.bottom.toLong())
                                    }
                                } else {
                                    report.flag("code_field_accessible", false)
                                }
                                delay(100)
                            }
                        }
                        stage = 3
                        assertTrue("A verification HTTP response must be observed", verificationResponses.get() > 0L)
                        report.flag("passed", true)
                    }
                } finally {
                    scenario.onActivity {
                        observation.close()
                        report.flag("observer_restored", true)
                    }
                }
            }
        } catch (_: Throwable) {
            report.flag("passed", false)
            throw AssertionError("Scoped login HTTP diagnostic failed at stage $stage")
        } finally {
            report.number("stage", stage)
            report.publish()
        }
    }

    private fun passwordFieldCounts(): FieldCounts? = synchronized(accessibilityLock) {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val root = instrumentation.uiAutomation.rootInActiveWindow ?: return@synchronized null
        try {
            if (root.packageName?.toString() != instrumentation.targetContext.packageName) return@synchronized null
            val fields = mutableListOf<FieldCounts>()
            inspectPasswordFields(root, fields)
            fields.singleOrNull()
        } finally {
            root.recycle()
        }
    }

    private fun inspectPasswordFields(node: AccessibilityNodeInfo, fields: MutableList<FieldCounts>) {
        if (node.isVisibleToUser && node.isPassword && node.className?.toString() == "android.widget.EditText") {
            val text = node.text
            val bounds = Rect()
            node.getBoundsInScreen(bounds)
            fields += FieldCounts(text?.length ?: 0, text?.count { it in '0'..'9' } ?: 0, bounds)
        }
        for (index in 0 until node.childCount) {
            val child = node.getChild(index) ?: continue
            try {
                inspectPasswordFields(child, fields)
            } finally {
                child.recycle()
            }
        }
    }

    private fun submitLoginButton(): Boolean = synchronized(accessibilityLock) {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val root = instrumentation.uiAutomation.rootInActiveWindow ?: return@synchronized false
        try {
            if (root.packageName?.toString() != instrumentation.targetContext.packageName) return@synchronized false
            val nodes = root.findAccessibilityNodeInfosByText("登录")
            try {
                val button = nodes.singleOrNull { it.text?.toString() == "登录" && it.isVisibleToUser && it.isEnabled }
                    ?: return@synchronized false
                if (button.isClickable) return@synchronized button.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                val parent = button.parent ?: return@synchronized false
                try {
                    parent.className?.toString() == "android.widget.Button" && parent.isVisibleToUser &&
                        parent.isEnabled && parent.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                } finally {
                    parent.recycle()
                }
            } finally {
                nodes.forEach { it.recycle() }
            }
        } finally {
            root.recycle()
        }
    }

    /** Numeric allowlist only. The response bytes remain in this test's memory. */
    private fun loginErrorKind(response: Response): Int = try {
        val error = JSONObject(response.peekBody(4096).string())
        val code = listOf("error_code", "code", "error").map { error.optString(it) }
        when {
            "otp_expired" in code -> 1
            "over_email_send_rate_limit" in code -> 2
            "over_request_rate_limit" in code -> 3
            "user_not_found" in code -> 4
            "validation_failed" in code -> 5
            "bad_jwt" in code -> 6
            "email_not_confirmed" in code -> 7
            "invalid_credentials" in code -> 8
            else -> 0
        }
    } catch (_: Exception) {
        0
    }

    private data class FieldCounts(val characters: Int, val digits: Int, val bounds: Rect)

    private class ClientObservation(
        private val owner: Any,
        private val field: Field,
        private val original: OkHttpClient,
        private val observed: OkHttpClient,
    ) : Closeable {
        override fun close() {
            check(field.get(owner) === observed) { "The observed client changed during diagnostics" }
            field.set(owner, original)
            check(field.get(owner) === original) { "The original account client was not restored" }
        }

        companion object {
            fun install(controller: TabletController, listener: EventListener, interceptor: Interceptor): ClientObservation {
                val accountField = controller.javaClass.getDeclaredField("account").apply { isAccessible = true }
                val account = requireNotNull(accountField.get(controller))
                val httpField = account.javaClass.getDeclaredField("http").apply { isAccessible = true }
                val http = requireNotNull(httpField.get(account))
                val clientField = http.javaClass.getDeclaredField("client").apply { isAccessible = true }
                val original = clientField.get(http) as? OkHttpClient
                    ?: throw AssertionError("The account client is not the expected OkHttp implementation")
                val observed = original.newBuilder().eventListener(listener).addInterceptor(interceptor).build()
                val observation = ClientObservation(http, clientField, original, observed)
                clientField.set(http, observed)
                if (clientField.get(http) !== observed) {
                    clientField.set(http, original)
                    throw AssertionError("The account HTTP observer could not be installed")
                }
                return observation
            }
        }
    }
}
