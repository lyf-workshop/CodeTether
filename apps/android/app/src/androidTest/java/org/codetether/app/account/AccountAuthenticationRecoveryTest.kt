package org.codetether.app.account

import android.content.Context
import android.content.ContextWrapper
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.Closeable
import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.security.KeyStore
import java.security.MessageDigest
import java.util.Base64
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import uniffi.supervisor_mobile.MobileException

@RunWith(AndroidJUnit4::class)
class AccountAuthenticationRecoveryTest {
    @Test
    fun directoryRefreshesOnceAndRegeneratesProofForTheNewToken() = runBlocking {
        val refreshes = AtomicInteger()
        val proofs = mutableListOf<JSONObject>()
        Fixture { request ->
            when (request.url.encodedPath) {
                "/auth/v1/token" -> {
                    refreshes.incrementAndGet()
                    Reply(200, sessionResponse(NEW_ACCESS))
                }
                "/v1/hosts/directory" -> {
                    val compact = requireNotNull(request.header("x-codetether-device-proof"))
                    proofs += JSONObject(String(Base64.getUrlDecoder().decode(compact.split('.')[1]), Charsets.UTF_8))
                    if (request.header("Authorization") == "Bearer $OLD_ACCESS") loginRejected()
                    else Reply(200, """{"hosts":[]}""")
                }
                else -> throw AssertionError("Unexpected synthetic request")
            }
        }.use { fixture ->
            fixture.login()
            val original = fixture.sessions.current()
            assertTrue(fixture.control.directory(original, fixture.device).isEmpty())
            assertTrue(fixture.control.directory(original, fixture.device).isEmpty())
            assertEquals(1, refreshes.get())
            assertEquals(3, proofs.size)
            assertTrue(proofs[0].getString("authTokenHash") == "sha256:" + digest(OLD_ACCESS))
            assertTrue(proofs.drop(1).all { it.getString("authTokenHash") == "sha256:" + digest(NEW_ACCESS) })
            assertTrue(proofs[0].getString("nonce") != proofs[1].getString("nonce"))
        }
    }

    @Test
    fun concurrentRejectionsShareOneRefreshAndStaleFailuresKeepTheNewSession() = runBlocking {
        for (access in listOf(OLD_ACCESS, NEW_ACCESS)) {
            val refreshes = AtomicInteger()
            Fixture { request ->
                assertEquals("/auth/v1/token", request.url.encodedPath)
                refreshes.incrementAndGet()
                Reply(200, sessionResponse(access))
            }.use { fixture ->
                fixture.login()
                val rejected = fixture.sessions.current()
                val refreshed = List(2) { async(Dispatchers.Default) { fixture.sessions.refreshRejected(rejected) } }.awaitAll()
                assertEquals(1, refreshes.get())
                assertTrue(refreshed.all { it.accessToken == access })
                fixture.sessions.clearRejected(rejected)
                assertTrue(fixture.sessions.current().accessToken == access)
            }
        }
    }

    @Test
    fun aRejectedRefreshClearsThePersistedLoginForEveryDefinitiveRejection() = runBlocking {
        for (status in listOf(400, 401, 403)) {
            val refreshes = AtomicInteger()
            Fixture { request ->
                when (request.url.encodedPath) {
                    "/auth/v1/token" -> {
                        refreshes.incrementAndGet()
                        Reply(status, "{}")
                    }
                    "/v1/hosts/directory" -> loginRejected()
                    else -> throw AssertionError("Unexpected synthetic request")
                }
            }.use { fixture ->
                fixture.login()
                val failure = runCatching { fixture.control.directory(fixture.sessions.current(), fixture.device) }.exceptionOrNull()
                assertTrue(failure is AccountFailure && failure.reason == AccountFailureReason.SIGN_IN_REQUIRED)
                assertEquals(1, refreshes.get())
                assertNull(fixture.sessions.restore())
                assertNull(fixture.reopen().restore())
            }
        }
    }

    @Test
    fun aTransientRefreshFailureKeepsThePersistedLogin() = runBlocking {
        Fixture { request ->
            when (request.url.encodedPath) {
                "/auth/v1/token" -> Reply(503, "{}")
                "/v1/hosts/directory" -> loginRejected()
                else -> throw AssertionError("Unexpected synthetic request")
            }
        }.use { fixture ->
            fixture.login()
            val failure = runCatching { fixture.control.directory(fixture.sessions.current(), fixture.device) }.exceptionOrNull()
            assertTrue(failure is AccountFailure && failure.reason == AccountFailureReason.REQUEST_FAILED)
            assertTrue(fixture.reopen().restore() != null)
        }
    }

    @Test
    fun deviceProofAndUnclassified401NeverRefreshOrClearTheHumanSession() = runBlocking {
        for (reply in listOf(
            Reply(401, """{"status":"device_authentication_failed","code":"device_proof_token_binding_mismatch"}"""),
            Reply(401, """{"status":"authentication_failed","code":"device_proof_expired"}"""),
            Reply(401, "{}"),
        )) {
            val requests = AtomicInteger()
            Fixture {
                requests.incrementAndGet()
                reply
            }.use { fixture ->
                fixture.login()
                val failure = runCatching { fixture.control.directory(fixture.sessions.current(), fixture.device) }.exceptionOrNull()
                assertTrue(failure is AccountFailure && failure.reason != AccountFailureReason.SIGN_IN_REQUIRED)
                assertEquals(1, requests.get())
                assertTrue(fixture.reopen().restore() != null)
            }
        }
    }

    @Test
    fun directoryStopsAndClearsLoginAfterASecondHumanAuthenticationRejection() = runBlocking {
        val refreshes = AtomicInteger()
        val directories = AtomicInteger()
        Fixture { request ->
            when (request.url.encodedPath) {
                "/auth/v1/token" -> {
                    refreshes.incrementAndGet()
                    Reply(200, sessionResponse(NEW_ACCESS))
                }
                "/v1/hosts/directory" -> {
                    directories.incrementAndGet()
                    loginRejected()
                }
                else -> throw AssertionError("Unexpected synthetic request")
            }
        }.use { fixture ->
            fixture.login()
            val failure = runCatching { fixture.control.directory(fixture.sessions.current(), fixture.device) }.exceptionOrNull()
            assertTrue(failure is AccountFailure && failure.reason == AccountFailureReason.SIGN_IN_REQUIRED)
            assertEquals(1, refreshes.get())
            assertEquals(2, directories.get())
            assertNull(fixture.reopen().restore())
        }
    }

    @Test
    fun anAuthenticationRejectionDoesNotReplayThePairingWrite() = runBlocking {
        val claims = AtomicInteger()
        val refreshes = AtomicInteger()
        Fixture { request ->
            when (request.url.encodedPath) {
                "/v1/pairing-sessions/redeem" -> {
                    claims.incrementAndGet()
                    loginRejected()
                }
                "/auth/v1/token" -> {
                    refreshes.incrementAndGet()
                    Reply(200, sessionResponse(NEW_ACCESS))
                }
                else -> throw AssertionError("Unexpected synthetic request")
            }
        }.use { fixture ->
            fixture.login()
            val failure = runCatching { fixture.control.pair({ fixture.sessions.current() }, fixture.device, "135790") {} }.exceptionOrNull()
            assertTrue(failure is AccountFailure && failure.reason == AccountFailureReason.REQUEST_FAILED)
            assertEquals(1, claims.get())
            assertEquals(1, refreshes.get())
            assertTrue(fixture.sessions.current().accessToken == NEW_ACCESS)
        }
    }

    @Test
    fun cancellingSignOutStillClearsDiskAndFinishesLocalCleanup() = runBlocking {
        val logouts = AtomicInteger()
        Fixture {
            logouts.incrementAndGet()
            Reply(200, "{}")
        }.use { fixture ->
            fixture.login()
            val account = TabletAccount(fixture.context, fixture.http, fixture.sessions)
            val entered = CompletableDeferred<Unit>()
            val finishCleanup = CompletableDeferred<Unit>()
            val cleaned = AtomicBoolean()
            val job = launch(Dispatchers.Default) {
                account.signOut {
                    entered.complete(Unit)
                    finishCleanup.await()
                    cleaned.set(true)
                }
            }
            entered.await()
            job.cancel()
            finishCleanup.complete(Unit)
            job.join()
            assertTrue(cleaned.get())
            assertNull(fixture.sessions.restore())
            assertNull(fixture.reopen().restore())
            assertEquals(0, logouts.get())
        }
    }

    @Test
    fun aDeletedKeystoreIdentityFailsThroughTheDeclaredNativeCallbackError() {
        Fixture { throw AssertionError("No synthetic HTTP request is expected") }.use { fixture ->
            assertTrue(fixture.device.identity.signDer(byteArrayOf(1)).isNotEmpty())
            fixture.deleteDeviceKey()
            val failure = runCatching { fixture.device.identity.signDer(byteArrayOf(1)) }.exceptionOrNull()
            assertTrue(failure is MobileException.Failure && failure.code == "device_identity_unavailable")
        }
    }

    private data class Reply(val status: Int, val body: String)

    private class Fixture(respond: (Request) -> Reply) : Closeable {
        private val app = InstrumentationRegistry.getInstrumentation().targetContext
        private val sandbox = Files.createTempDirectory(app.cacheDir.toPath(), "account-recovery-").toFile()
        val context: Context = object : ContextWrapper(app) {
            override fun getApplicationContext(): Context = this
            override fun getNoBackupFilesDir(): File = sandbox
        }
        private val identityName = "synthetic-authentication-recovery-" + UUID.randomUUID()
        private val identity = AndroidDeviceIdentity.loadOrCreate(context, identityName)
        val device = RegisteredDevice("dev_synthetic_recovery", "usr_synthetic_recovery", 1uL, identity.fingerprint, identity)
        val http = AccountHttp(OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            val reply = try {
                if (request.url.encodedPath == "/auth/v1/verify") Reply(200, sessionResponse(OLD_ACCESS))
                else respond(request)
            } catch (_: Throwable) {
                throw IOException("Synthetic account response contract mismatch")
            }
            // Every synthetic request terminates before DNS or a network connection.
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1)
                .code(reply.status).message("Synthetic account response")
                .body(reply.body.toResponseBody()).build()
        }.build())
        val sessions = reopen()
        val control = ControlPlane(context, http, "https://control.example.invalid".toHttpUrl(), sessions)

        fun reopen(): AccountSessions = AccountSessions(context, http, "https://auth.example.invalid", "synthetic-key")

        suspend fun login() {
            sessions.verifyCode("fixture@example.invalid", "135790")
        }

        override fun close() {
            EncryptedAccountStore(context).clear()
            sandbox.delete()
            deleteDeviceKey()
        }

        fun deleteDeviceKey() {
            val alias = "org.codetether.app.device.v1." + digest(identityName)
            KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.deleteEntry(alias)
        }
    }

    private companion object {
        const val OLD_ACCESS = "synthetic-access-before"
        const val NEW_ACCESS = "synthetic-access-after"

        fun sessionResponse(access: String): String = JSONObject()
            .put("user", JSONObject().put("id", "synthetic-recovery-account").put("email", "fixture@example.invalid"))
            .put("access_token", access).put("refresh_token", "synthetic-refresh")
            .put("expires_in", 3_600).toString()

        fun loginRejected() = Reply(401, """{"status":"authentication_failed","code":"expired_token"}""")

        fun digest(value: String): String = Base64.getUrlEncoder().withoutPadding().encodeToString(
            MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8)),
        )
    }
}
