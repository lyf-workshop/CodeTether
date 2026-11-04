package org.codetether.app.account

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.IOException
import java.time.Instant
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ControlPlanePairingTest {
    @Test
    fun devicePairedResponseNeedsNoOwnerAuthorizationAndWaitsForDirectoryReadiness() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val identity = AndroidDeviceIdentity.loadOrCreate(context, "synthetic-pairing-regression-account")
        val device = RegisteredDevice("dev_synthetic_pairing", "usr_synthetic_pairing", 1uL, identity.fingerprint, identity)
        val session = AccountSession(
            AccountProfile("synthetic-pairing-regression-account", "pairing@example.invalid"),
            "synthetic-access-token", "synthetic-refresh-token", Instant.now().epochSecond + 3_600,
        )
        val origin = "https://pairing.example.invalid/".toHttpUrl()
        val expiresAt = Instant.now().plusSeconds(300).toString()
        val sessionView = JSONObject()
            .put("sessionId", "enroll_synthetic_pairing")
            .put("hostId", "host_synthetic_pairing")
            .put("expiresAt", expiresAt)
        // B1 readClaim returns sessionView only, including after the owner completes pairing.
        val paired = JSONObject(sessionView.toString()).put("status", "paired")
        assertTrue("The device response fixture must omit the owner's authorization object", !paired.has("authorization"))
        val waiting = directoryHost(device, expiresAt).put("supervisor", JSONObject.NULL)
        val ready = directoryHost(device, expiresAt).put(
            "supervisor",
            JSONObject()
                .put("grant", JSONObject().put("proof", "synthetic-grant-proof").put(
                    "payload", JSONObject()
                        .put("purpose", "host_supervisor_grant")
                        .put("authorizationId", "hauth_synthetic_pairing")
                        .put("scope", "supervisor_control")
                        .put("hostId", "host_synthetic_pairing")
                        .put("deviceId", device.id)
                        .put("userId", device.ownerId)
                        .put("deviceFingerprint", device.fingerprint)
                        .put("deviceKeyGeneration", 1),
                ))
                .put("transport", JSONObject().put("proof", "synthetic-transport-proof").put(
                    "payload", JSONObject()
                        .put("purpose", "host_supervisor_presence")
                        .put("hostId", "host_synthetic_pairing")
                        .put("controlPlaneOrigin", origin.toString().removeSuffix("/")),
                )),
        )
        val replies = listOf(
            Triple("POST", "/v1/pairing-sessions/redeem", JSONObject(sessionView.toString()).put("status", "claimed")),
            Triple("GET", "/v1/pairing-sessions/enroll_synthetic_pairing", paired),
            Triple("GET", "/v1/hosts/directory", JSONObject().put("hosts", JSONArray().put(waiting))),
            Triple("GET", "/v1/hosts/directory", JSONObject().put("hosts", JSONArray().put(ready))),
        )
        val requestCount = AtomicInteger()
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            val expected = replies.getOrNull(requestCount.getAndIncrement())
                ?: throw IOException("Unexpected synthetic pairing request")
            if (!request.url.isHttps || request.url.host != origin.host || request.url.port != origin.port ||
                request.method != expected.first || request.url.encodedPath != expected.second ||
                request.header("x-codetether-device-proof").isNullOrBlank()
            ) throw IOException("Synthetic pairing request contract mismatch")
            // Every request terminates here. The interceptor never invokes chain.proceed().
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1)
                .code(200).message("Synthetic response")
                .body(expected.third.toString().toResponseBody("application/json".toMediaType()))
                .build()
        }.build()
        val control = ControlPlane(context, AccountHttp(client), origin)
        var claimed = false
        val result = withTimeout(15_000L) { control.pair({ session }, device, "135790") { claimed = true } }
        assertTrue("The claimed callback must run", claimed)
        assertTrue("The paired response must reach the ready directory entry", result is PairingResult.Paired)
        val computer = (result as PairingResult.Paired).computer
        assertTrue("The paired host must retain the claimed identity", computer.id == "host_synthetic_pairing")
        assertTrue("The directory must provide the usable control authorization", computer.allowsControl && computer.isAvailable)
        assertTrue("The directory's authorization must be used", computer.authorizationId == "hauth_synthetic_pairing")
        assertTrue("The pending directory entry must be retried", requestCount.get() == replies.size)
    }

    private fun directoryHost(device: RegisteredDevice, expiresAt: String): JSONObject = JSONObject()
        .put("hostId", "host_synthetic_pairing")
        .put("fingerprint", "synthetic-host-fingerprint")
        .put("identityGeneration", 1)
        .put("publicKey", device.identity.publicJwk)
        .put("safeLabel", "Synthetic pairing host")
        .put("coarsePlatform", "win32")
        .put("authorization", JSONObject()
            .put("state", "authorized")
            .put("scope", "supervisor_control")
            .put("expiresAt", expiresAt)
            .put("authorizationId", "hauth_synthetic_pairing"),
        )
}
