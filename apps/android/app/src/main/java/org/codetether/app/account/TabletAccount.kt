package org.codetether.app.account

import android.content.Context
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.codetether.app.BuildConfig
import uniffi.supervisor_mobile.ConnectOptions
import uniffi.supervisor_mobile.ConnectionMode
import uniffi.supervisor_mobile.DeviceSigner

class TabletAccount(context: Context) {
    private val http = AccountHttp()
    private val sessions = AccountSessions(context.applicationContext, http)
    private val control = ControlPlane(context.applicationContext, http)
    private val registration = Mutex()

    @Volatile private var activeDevice: AccountDevice? = null

    val isConfigured: Boolean
        get() = runCatching {
            configurationOrigin(BuildConfig.CONTROL_PLANE_URL)
            configurationOrigin(BuildConfig.SUPABASE_URL)
            isPublishableKeyConfigured(BuildConfig.SUPABASE_PUBLISHABLE_KEY)
        }.getOrDefault(false)

    suspend fun restore(): AccountProfile? = sessions.restore()

    suspend fun requestCode(email: String) = sessions.requestCode(email)

    suspend fun verifyCode(email: String, code: String): AccountProfile = registration.withLock {
        sessions.verifyCode(email, code).also { activeDevice = null }
    }

    suspend fun computers(): List<PairedComputer> {
        val session = sessions.current()
        return control.directory(session, registeredDevice(session))
    }

    suspend fun pair(code: String, onClaimed: () -> Unit = {}): PairingResult {
        val trimmed = code.trim()
        if (trimmed.length != 6 || trimmed.any { it !in '0'..'9' }) {
            return PairingResult.Rejected(PairingRejection.INVALID_CODE, null)
        }
        val session = sessions.current()
        val device = registeredDevice(session)
        return control.pair(
            {
                sessions.current().also {
                    if (it.profile.id != session.profile.id) throw AccountFailure(AccountFailureReason.SIGN_IN_REQUIRED)
                }
            },
            device,
            trimmed,
            onClaimed,
        )
    }

    suspend fun removeComputer(computer: PairedComputer) {
        val session = sessions.current()
        control.remove(session, registeredDevice(session), computer)
    }

    suspend fun signOut() {
        val previous = withContext(NonCancellable) {
            registration.withLock {
                sessions.clearLocalSession().also { activeDevice = null }
            }
        }
        sessions.endRemoteSession(previous)
    }

    suspend fun keyProtection(): KeyProtection = registeredDevice(sessions.current()).identity.protection

    suspend fun connection(computer: PairedComputer, mode: ConnectionMode): ConnectionCredentials {
        val session = sessions.current()
        val device = registeredDevice(session)
        val grant = computer.grantJson ?: throw AccountFailure(AccountFailureReason.COMPUTER_UNAVAILABLE)
        val descriptor = computer.descriptorJson ?: throw AccountFailure(AccountFailureReason.COMPUTER_UNAVAILABLE)
        control.validateRelayConfig(computer, mode)
        return ConnectionCredentials(
            ConnectOptions(
                hostId = computer.id,
                hostFingerprint = computer.fingerprint,
                hostIdentityGeneration = computer.generation,
                hostPublicJwkJson = computer.publicKeyJson,
                deviceId = device.id,
                deviceKeyGeneration = device.generation,
                grantJson = grant,
                descriptorJson = descriptor,
                accessToken = session.accessToken,
                mode = mode,
            ),
            signerFor(device),
        )
    }

    suspend fun connectionOptions(computer: PairedComputer, mode: ConnectionMode): ConnectOptions =
        connection(computer, mode).options

    val deviceSigner: DeviceSigner
        get() = signerFor(activeDevice?.device ?: throw AccountFailure(AccountFailureReason.DEVICE_IDENTITY_UNAVAILABLE))

    private fun signerFor(device: RegisteredDevice): DeviceSigner = object : DeviceSigner {
        override fun signDer(message: ByteArray): ByteArray {
            if (activeDevice?.device !== device) throw AccountFailure(AccountFailureReason.SIGN_IN_REQUIRED)
            return device.identity.signDer(message)
        }
    }

    private suspend fun registeredDevice(session: AccountSession): RegisteredDevice = registration.withLock {
        val current = sessions.current()
        if (current.profile.id != session.profile.id) throw AccountFailure(AccountFailureReason.SIGN_IN_REQUIRED)
        activeDevice?.takeIf { it.accountId == current.profile.id }?.device ?: control.register(current).also {
            activeDevice = AccountDevice(current.profile.id, it)
        }
    }

    private class AccountDevice(val accountId: String, val device: RegisteredDevice)
}
