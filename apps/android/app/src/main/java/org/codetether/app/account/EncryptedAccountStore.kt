package org.codetether.app.account

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import java.io.File
import java.io.IOException
import java.security.GeneralSecurityException
import java.security.KeyStore
import java.security.ProviderException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONObject

internal class AccountSession(
    val profile: AccountProfile,
    val accessToken: String,
    val refreshToken: String,
    val expiresAt: Long,
)

internal class EncryptedAccountStore(context: Context) {
    private val file = AtomicFile(File(context.noBackupFilesDir, "account-session.v1"))

    fun load(): AccountSession? {
        val encrypted = try {
            file.openRead().use { stream ->
                val buffer = ByteArray(MAX_BYTES + 1)
                var count = 0
                while (count < buffer.size) {
                    val read = stream.read(buffer, count, buffer.size - count)
                    if (read < 0) break
                    count += read
                }
                buffer.copyOf(count)
            }
        } catch (_: IOException) {
            return null
        }
        return try {
            if (encrypted.size !in (IV_BYTES + 17)..MAX_BYTES || encrypted[0] != VERSION) {
                invalidResponse()
            }
            val key = existingKey() ?: invalidResponse()
            val cipher = Cipher.getInstance(TRANSFORM)
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, encrypted, 1, IV_BYTES))
            cipher.updateAAD(AAD)
            val plain = cipher.doFinal(encrypted, IV_BYTES + 1, encrypted.size - IV_BYTES - 1)
            try {
                parseSession(parseJson(plain.toString(Charsets.UTF_8)))
            } finally {
                plain.fill(0)
            }
        } catch (_: GeneralSecurityException) {
            clear()
            null
        } catch (_: AccountFailure) {
            clear()
            null
        } catch (_: IOException) {
            null
        } catch (_: ProviderException) {
            null
        }
    }

    fun save(session: AccountSession) {
        val plain = JSONObject()
            .put("user_id", session.profile.id)
            .put("email", session.profile.email)
            .put("access_token", session.accessToken)
            .put("refresh_token", session.refreshToken)
            .put("expires_at", session.expiresAt)
            .toString().toByteArray(Charsets.UTF_8)
        try {
            val cipher = Cipher.getInstance(TRANSFORM)
            cipher.init(Cipher.ENCRYPT_MODE, existingKey() ?: createKey())
            cipher.updateAAD(AAD)
            val iv = cipher.iv
            if (iv.size != IV_BYTES) invalidResponse()
            val encrypted = byteArrayOf(VERSION) + iv + cipher.doFinal(plain)
            if (encrypted.size > MAX_BYTES) invalidResponse()
            val stream = file.startWrite()
            try {
                stream.write(encrypted)
                file.finishWrite(stream)
            } catch (e: IOException) {
                file.failWrite(stream)
                throw e
            }
        } catch (_: GeneralSecurityException) {
            throw AccountFailure(AccountFailureReason.DEVICE_IDENTITY_UNAVAILABLE)
        } catch (_: ProviderException) {
            throw AccountFailure(AccountFailureReason.DEVICE_IDENTITY_UNAVAILABLE)
        } catch (_: IOException) {
            throw AccountFailure(AccountFailureReason.DEVICE_IDENTITY_UNAVAILABLE)
        } finally {
            plain.fill(0)
        }
    }

    fun clear() {
        file.delete()
    }

    private fun existingKey(): SecretKey? = KeyStore.getInstance("AndroidKeyStore").run {
        load(null)
        getKey(KEY_ALIAS, null) as? SecretKey
    }

    private fun createKey(): SecretKey =
        KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(
                KeyGenParameterSpec.Builder(
                    KEY_ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                )
                    .setKeySize(256)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .build(),
            )
            generateKey()
        }

    private fun parseSession(json: JSONObject): AccountSession = AccountSession(
        AccountProfile(json.stringValue("user_id"), json.stringValue("email", 320)),
        json.stringValue("access_token", 8192),
        json.stringValue("refresh_token", 8192),
        json.longValue("expires_at"),
    )

    private companion object {
        const val KEY_ALIAS = "org.codetether.app.account.aes.v1"
        const val TRANSFORM = "AES/GCM/NoPadding"
        const val MAX_BYTES = 32 * 1024
        const val IV_BYTES = 12
        const val VERSION: Byte = 1
        val AAD = "org.codetether.app.account-session.v1".toByteArray(Charsets.UTF_8)
    }
}
