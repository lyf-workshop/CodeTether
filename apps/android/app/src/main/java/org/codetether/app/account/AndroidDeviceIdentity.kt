package org.codetether.app.account

import android.content.Context
import android.content.pm.PackageManager
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import android.os.Build
import java.math.BigInteger
import java.security.GeneralSecurityException
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.ProviderException
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.util.Base64
import org.codetether.app.BuildConfig
import org.json.JSONObject
import uniffi.supervisor_mobile.DeviceSigner

internal class AndroidDeviceIdentity private constructor(
    private val alias: String,
    val protection: KeyProtection,
    val publicJwk: JSONObject,
    val fingerprint: String,
) : DeviceSigner {
    private val nativeSigner = DeviceSignerBoundary({ true }) { message ->
        keystoreOperation {
            val key = keyStore().getKey(alias, null) as? java.security.PrivateKey ?: unavailable()
            Signature.getInstance("SHA256withECDSA").run {
                initSign(key)
                update(message)
                sign()
            }
        }
    }

    override fun signDer(message: ByteArray): ByteArray = nativeSigner.signDer(message)

    companion object {
        fun loadOrCreate(context: Context, accountId: String): AndroidDeviceIdentity = keystoreOperation {
            val alias = "org.codetether.app.device.v1." + digest(accountId.toByteArray(Charsets.UTF_8))
            val store = keyStore()
            if (!store.containsAlias(alias)) {
                if (context.packageManager.hasSystemFeature(PackageManager.FEATURE_STRONGBOX_KEYSTORE)) {
                    try {
                        generate(alias, strongBox = true)
                    } catch (_: StrongBoxUnavailableException) {
                        generate(alias, strongBox = false)
                    }
                } else {
                    generate(alias, strongBox = false)
                }
            }

            val entry = store.getEntry(alias, null) as? KeyStore.PrivateKeyEntry ?: unavailable()
            val keyInfo = KeyFactory.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
                .getKeySpec(entry.privateKey, KeyInfo::class.java)
            val protection = when (keyInfo.securityLevel) {
                KeyProperties.SECURITY_LEVEL_STRONGBOX -> KeyProtection.STRONGBOX
                KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT -> KeyProtection.TEE
                KeyProperties.SECURITY_LEVEL_SOFTWARE -> KeyProtection.SOFTWARE
                else -> unavailable()
            }
            if (protection == KeyProtection.SOFTWARE && !(BuildConfig.DEBUG && isEmulator())) {
                unavailable()
            }

            val publicKey = entry.certificate.publicKey as? ECPublicKey ?: unavailable()
            val x = coordinate(publicKey.w.affineX)
            val y = coordinate(publicKey.w.affineY)
            val canonical = """{"crv":"P-256","kty":"EC","x":"$x","y":"$y"}"""
            AndroidDeviceIdentity(
                alias, protection, JSONObject(canonical),
                "sha256:" + digest(canonical.toByteArray(Charsets.UTF_8)),
            )
        }

        private fun generate(alias: String, strongBox: Boolean) {
            KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore").apply {
                initialize(
                    KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN)
                        .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                        .setDigests(KeyProperties.DIGEST_SHA256)
                        .setIsStrongBoxBacked(strongBox)
                        .build(),
                )
                generateKeyPair()
            }
        }

        private fun coordinate(value: BigInteger): String {
            if (value.signum() < 0 || value.bitLength() > 256) unavailable()
            val raw = value.toByteArray()
            val offset = if (raw.size > 32) 1 else 0
            val unsigned = raw.copyOfRange(offset, raw.size)
            return URL_ENCODER.encodeToString(ByteArray(32 - unsigned.size) + unsigned)
        }

        private fun digest(bytes: ByteArray): String =
            URL_ENCODER.encodeToString(MessageDigest.getInstance("SHA-256").digest(bytes))

        private fun keyStore(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

        private fun isEmulator(): Boolean =
            Build.FINGERPRINT.startsWith("generic") || Build.FINGERPRINT.startsWith("google/sdk_gphone") ||
                Build.HARDWARE == "ranchu" || Build.HARDWARE == "goldfish"

        private inline fun <T> keystoreOperation(block: () -> T): T = try {
            block()
        } catch (_: GeneralSecurityException) {
            unavailable()
        } catch (_: java.io.IOException) {
            unavailable()
        } catch (_: ProviderException) {
            unavailable()
        }

        private fun unavailable(): Nothing = throw AccountFailure(AccountFailureReason.DEVICE_IDENTITY_UNAVAILABLE)

        private val URL_ENCODER = Base64.getUrlEncoder().withoutPadding()
    }
}
