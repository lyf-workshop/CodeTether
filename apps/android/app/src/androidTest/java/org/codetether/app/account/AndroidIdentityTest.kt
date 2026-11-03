package org.codetether.app.account

import android.content.Context
import android.content.ContextWrapper
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.math.BigInteger
import java.nio.file.Files
import java.security.AlgorithmParameters
import java.security.KeyFactory
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECParameterSpec
import java.security.spec.ECPoint
import java.security.spec.ECPublicKeySpec
import java.util.Base64
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import uniffi.supervisor_mobile.signCompactProof

@RunWith(AndroidJUnit4::class)
class AndroidIdentityTest {
    @Test
    fun deviceIdentitySurvivesReloadAndProducesVerifiableDer() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val identity = AndroidDeviceIdentity.loadOrCreate(context, TEST_IDENTITY)
        val reloaded = AndroidDeviceIdentity.loadOrCreate(context, TEST_IDENTITY)
        assertEquals(identity.fingerprint, reloaded.fingerprint)
        assertEquals(identity.protection, reloaded.protection)

        val point = ECPoint(coordinate(reloaded, "x"), coordinate(reloaded, "y"))
        val parameters = AlgorithmParameters.getInstance("EC").run {
            init(ECGenParameterSpec("secp256r1"))
            getParameterSpec(ECParameterSpec::class.java)
        }
        val publicKey = KeyFactory.getInstance("EC").generatePublic(ECPublicKeySpec(point, parameters))
        val challenge = "synthetic Android device proof test".toByteArray()
        val verifier = Signature.getInstance("SHA256withECDSA").apply {
            initVerify(publicKey)
            update(challenge)
        }
        assertTrue(verifier.verify(reloaded.signDer(challenge)))

        val compactProof = signCompactProof(
            "codetether-device-registration+jws",
            """{"purpose":"device_registration","v":1}""",
            reloaded,
        )
        val parts = compactProof.split(".")
        assertEquals(3, parts.size)
        val rawSignature = Base64.getUrlDecoder().decode(parts[2])
        assertEquals(64, rawSignature.size)
        val r = BigInteger(1, rawSignature.copyOfRange(0, 32)).toByteArray()
        val s = BigInteger(1, rawSignature.copyOfRange(32, 64)).toByteArray()
        val encodedIntegers = byteArrayOf(2, r.size.toByte()) + r + byteArrayOf(2, s.size.toByte()) + s
        val derSignature = byteArrayOf(0x30, encodedIntegers.size.toByte()) + encodedIntegers
        verifier.initVerify(publicKey)
        verifier.update((parts[0] + "." + parts[1]).toByteArray(Charsets.US_ASCII))
        assertTrue(verifier.verify(derSignature))
        Log.i("CodeTetherIdentityTest", "Keystore security level: ${reloaded.protection.name}")
    }

    @Test
    fun accountSessionRestoresFromCiphertextAndCanBeCleared() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val sandbox = Files.createTempDirectory(context.cacheDir.toPath(), "account-store-test-").toFile()
        val testContext = object : ContextWrapper(context) {
            override fun getNoBackupFilesDir(): File = sandbox
        }
        val store = EncryptedAccountStore(testContext)
        val sample = AccountSession(
            AccountProfile("fixture-account", "fixture@example.invalid"),
            "synthetic-access-test-string",
            "synthetic-refresh-test-string",
            2_000_000_000L,
        )
        try {
            store.save(sample)
            val payload = sandbox.resolve("account-session.v1").readBytes().toString(Charsets.ISO_8859_1)
            assertFalse(payload.contains(sample.accessToken))
            assertFalse(payload.contains(sample.refreshToken))
            assertFalse(payload.contains(sample.profile.email))
            val restored = EncryptedAccountStore(testContext).load()
            assertEquals(sample.profile.id, restored?.profile?.id)
            assertEquals(sample.expiresAt, restored?.expiresAt)
            assertTrue(restored?.accessToken == sample.accessToken)
            assertTrue(restored?.refreshToken == sample.refreshToken)
            store.clear()
            assertNull(EncryptedAccountStore(testContext).load())
        } finally {
            store.clear()
            sandbox.delete()
        }
    }

    private fun coordinate(identity: AndroidDeviceIdentity, name: String) =
        BigInteger(1, Base64.getUrlDecoder().decode(identity.publicJwk.getString(name)))

    private companion object {
        const val TEST_IDENTITY = "org.codetether.synthetic.keystore.integration"
    }
}
