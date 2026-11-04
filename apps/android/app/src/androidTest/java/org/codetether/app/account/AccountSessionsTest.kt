package org.codetether.app.account

import android.content.ContextWrapper
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.nio.file.Files
import java.util.concurrent.LinkedBlockingQueue
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AccountSessionsTest {
    @Test
    fun otpIsExistingAccountOnlyAndRejectedRefreshClearsSession() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val sandbox = Files.createTempDirectory(context.cacheDir.toPath(), "account-otp-test-").toFile()
        val testContext = object : ContextWrapper(context) {
            override fun getNoBackupFilesDir(): File = sandbox
        }
        val requests = LinkedBlockingQueue<Request>()
        val email = "fixture@example.invalid"
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            requests.add(request)
            val (status, body) = when (request.url.encodedPath) {
                "/auth/v1/otp" -> 200 to "{}"
                "/auth/v1/verify" -> 200 to JSONObject()
                    .put("user", JSONObject().put("id", "fixture-account").put("email", email))
                    .put("access_token", "synthetic-access")
                    .put("refresh_token", "synthetic-refresh")
                    .put("expires_in", 20)
                    .toString()
                "/auth/v1/token" -> 401 to "{}"
                else -> 404 to "{}"
            }
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1)
                .code(status).message("Synthetic auth response").body(body.toResponseBody()).build()
        }.build()
        val http = AccountHttp(client)
        fun sessions() = AccountSessions(testContext, http, "https://auth.example.invalid", "synthetic-key")
        try {
            val account = sessions()
            account.requestCode(email)
            val otp = requireNotNull(requests.poll())
            assertEquals("/auth/v1/otp", otp.url.encodedPath)
            assertEquals(email, otp.jsonBody().get("email"))
            assertEquals(false, otp.jsonBody().get("create_user"))

            val code = "135790"
            val verified = account.verifyCode(email, code)
            val verify = requireNotNull(requests.poll())
            assertEquals("/auth/v1/verify", verify.url.encodedPath)
            assertEquals("email", verify.jsonBody().get("type"))
            assertTrue(verify.jsonBody().get("token") == code)
            assertEquals("fixture-account", verified.id)
            assertEquals(email, verified.email)
            val restored = sessions().restore()
            assertEquals(verified.id, restored?.id)
            assertEquals(verified.email, restored?.email)

            val refreshFailure = runCatching { account.current() }.exceptionOrNull() as? AccountFailure
            assertEquals(AccountFailureReason.SIGN_IN_REQUIRED, refreshFailure?.reason)
            val refresh = requireNotNull(requests.poll())
            assertEquals("/auth/v1/token", refresh.url.encodedPath)
            assertEquals("refresh_token", refresh.url.queryParameter("grant_type"))
            assertNull(sessions().restore())
            assertNull(requests.poll())
        } finally {
            EncryptedAccountStore(testContext).clear()
            sandbox.delete()
        }
    }

    private fun Request.jsonBody(): JSONObject {
        val buffer = Buffer()
        requireNotNull(body).writeTo(buffer)
        return JSONObject(buffer.readUtf8())
    }
}
