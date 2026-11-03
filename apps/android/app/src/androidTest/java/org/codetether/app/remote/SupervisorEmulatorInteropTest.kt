package org.codetether.app.remote

import android.os.SystemClock
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.security.KeyStore
import java.security.MessageDigest
import java.util.Base64
import org.codetether.app.account.AndroidDeviceIdentity
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import uniffi.supervisor_mobile.ConnectOptions
import uniffi.supervisor_mobile.ConnectionMode
import uniffi.supervisor_mobile.MobileException
import uniffi.supervisor_mobile.connectSupervisor

@RunWith(AndroidJUnit4::class)
class SupervisorEmulatorInteropTest {
    @Test
    fun keystoreDeviceConnectsDirectlyAndThroughRelay() {
        val arguments = InstrumentationRegistry.getArguments()
        val runId = arguments.getString("t1aSupervisorInteropRun")
        assumeTrue("Requires the local Supervisor fixture runner", runId != null)
        require(runId != null && runId.matches(Regex("[a-f0-9]{32}")))

        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val accountId = "t1a-supervisor-fixture-$runId"
        val alias = "org.codetether.app.device.v1." + Base64.getUrlEncoder().withoutPadding().encodeToString(
            MessageDigest.getInstance("SHA-256").digest(accountId.toByteArray(Charsets.UTF_8)),
        )
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val publicJwk = File(context.filesDir, "t1a-supervisor-$runId-device.json")
        val stagedJwk = File(context.filesDir, "${publicJwk.name}.tmp")
        val fixtureFile = File(context.filesDir, "t1a-supervisor-$runId-fixture.json")
        val stagedFixture = File(context.filesDir, "${fixtureFile.name}.tmp")
        assertTrue("Synthetic account alias must be fresh", !keyStore.containsAlias(alias))
        try {
            val device = AndroidDeviceIdentity.loadOrCreate(context, accountId)
            assertNull("Android Keystore private key must be nonexportable", keyStore.getKey(alias, null).encoded)
            stagedJwk.writeText(device.publicJwk.toString())
            assertTrue("Publish the Keystore public key", stagedJwk.renameTo(publicJwk))
            val fixture = awaitFixture(fixtureFile)
            for (mode in listOf(ConnectionMode.DIRECT, ConnectionMode.RELAY)) {
                val transport = mode.name.lowercase()
                try {
                    exercise(fixture, device, mode, transport)
                } catch (failure: MobileException.Failure) {
                    val code = failure.code.takeIf { it.matches(Regex("[a-z_]{1,48}")) } ?: "unknown"
                    throw AssertionError("T1A interop $transport: $code")
                }
            }
        } finally {
            keyStore.deleteEntry(alias)
            stagedJwk.delete()
            publicJwk.delete()
            stagedFixture.delete()
            fixtureFile.delete()
        }
    }

    private fun awaitFixture(file: File): JSONObject {
        val deadline = SystemClock.elapsedRealtime() + 60_000
        while (!file.isFile && SystemClock.elapsedRealtime() < deadline) {
            Thread.sleep(100)
        }
        assertTrue("Local Supervisor fixture handshake timed out", file.isFile)
        return JSONObject(file.readText())
    }

    private fun exercise(
        fixture: JSONObject,
        signer: AndroidDeviceIdentity,
        mode: ConnectionMode,
        expectedTransport: String,
    ) {
        val grant = fixture.getJSONObject("grant")
        val session = connectSupervisor(
            ConnectOptions(
                hostId = fixture.getString("hostId"),
                hostFingerprint = fixture.getString("hostFingerprint"),
                hostIdentityGeneration = 1uL,
                hostPublicJwkJson = fixture.getJSONObject("publicJwk").toString(),
                deviceId = fixture.getString("deviceId"),
                deviceKeyGeneration = 1uL,
                grantJson = grant.toString(),
                descriptorJson = fixture.getJSONObject("descriptor").toString(),
                accessToken = fixture.getString("accessToken"),
                mode = mode,
            ),
            signer,
        )
        try {
            assertEquals(expectedTransport, session.transport())
            assertEquals("control", session.control())
            val machines = JSONObject(session.request("""{"operation":"machine.list"}"""))
            assertEquals("machine.list", machines.getString("fixtureOperation"))
            assertEquals(
                fixture.getString("machineId"),
                machines.getJSONArray("machines").getJSONObject(0).getString("machineId"),
            )
            val archive = JSONObject()
                .put("operation", "conversation.archive")
                .put("machineId", fixture.getString("machineId"))
                .put("projectId", fixture.getString("projectId"))
                .put("conversationId", fixture.getString("conversationId"))
                .put("actionId", "act_fixture_android_$expectedTransport")
            val result = JSONObject(session.request(archive.toString()))
            assertEquals("conversation.archive", result.getString("fixtureOperation"))
        } finally {
            try {
                session.disconnect()
            } finally {
                session.close()
            }
        }
    }
}
