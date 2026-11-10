package org.codetether.app.account

import uniffi.supervisor_mobile.DeviceSigner
import uniffi.supervisor_mobile.MobileException

/** UniFFI only transports the declared MobileException callback failures. */
internal class DeviceSignerBoundary(
    private val isAuthorized: () -> Boolean,
    private val sign: (ByteArray) -> ByteArray,
) : DeviceSigner {
    override fun signDer(message: ByteArray): ByteArray = try {
        requireAuthorization()
        val signature = sign(message)
        requireAuthorization()
        signature
    } catch (failure: MobileException.Failure) {
        val code = if (failure.code == "authorization_revoked") "authorization_revoked" else "device_identity_unavailable"
        throw MobileException.Failure(code, null, null)
    } catch (_: Throwable) {
        throw MobileException.Failure("device_identity_unavailable", null, null)
    }

    private fun requireAuthorization() {
        if (!isAuthorized()) throw MobileException.Failure("authorization_revoked", null, null)
    }
}
