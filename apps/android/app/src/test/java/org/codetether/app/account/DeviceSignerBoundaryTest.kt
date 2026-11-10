package org.codetether.app.account

import java.security.GeneralSecurityException
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Test
import uniffi.supervisor_mobile.ConnectOptions
import uniffi.supervisor_mobile.ConnectionMode
import uniffi.supervisor_mobile.MobileException

class DeviceSignerBoundaryTest {
    @Test
    fun callbackConvertsKeystoreExceptionsAndUnexpectedFailuresToTheDeclaredError() {
        for (failure in listOf(
            GeneralSecurityException("synthetic private detail"),
            IllegalStateException("synthetic private detail"),
            LinkageError("synthetic private detail"),
            MobileException.Failure("synthetic private detail", null, null),
        )) {
            val signer = DeviceSignerBoundary({ true }) { throw failure }
            val converted = assertThrows(MobileException.Failure::class.java) { signer.signDer(byteArrayOf(1)) }
            assertEquals("device_identity_unavailable", converted.code)
            assertFalse(converted.toString().contains("synthetic private detail"))
        }
        val failingGuard = DeviceSignerBoundary({ throw IllegalStateException("synthetic private detail") }) { it }
        assertThrows(MobileException.Failure::class.java) { failingGuard.signDer(byteArrayOf(1)) }
    }

    @Test
    fun revokedIdentityCannotSignBeforeOrDuringTheCallback() {
        var authorized = false
        var called = false
        val signer = DeviceSignerBoundary({ authorized }) {
            called = true
            authorized = false
            byteArrayOf(7)
        }
        val rejected = assertThrows(MobileException.Failure::class.java) { signer.signDer(byteArrayOf(1)) }
        assertEquals("authorization_revoked", rejected.code)
        assertFalse(called)
        authorized = true
        val revokedDuringSigning = assertThrows(MobileException.Failure::class.java) { signer.signDer(byteArrayOf(1)) }
        assertEquals("authorization_revoked", revokedDuringSigning.code)
    }

    @Test
    fun successfulCallbackPreservesTheDerSignature() {
        val signature = byteArrayOf(0x30, 0x01, 0x00)
        val signer = DeviceSignerBoundary({ true }) { signature }
        assertArrayEquals(signature, signer.signDer(byteArrayOf(1)))
    }

    @Test
    fun connectionCredentialsNeverRenderNativeOptions() {
        val options = ConnectOptions(
            "synthetic-host", "synthetic-fingerprint", 1uL, "synthetic-public-key", "synthetic-device",
            1uL, "synthetic-private-grant", "synthetic-descriptor", "synthetic-private-access", ConnectionMode.AUTO,
        )
        val credentials = ConnectionCredentials(options, DeviceSignerBoundary({ true }) { byteArrayOf() })
        assertEquals("ConnectionCredentials(redacted)", credentials.toString())
        assertFalse(credentials.toString().contains(options.accessToken))
        assertFalse(credentials.toString().contains(options.grantJson))
    }
}
