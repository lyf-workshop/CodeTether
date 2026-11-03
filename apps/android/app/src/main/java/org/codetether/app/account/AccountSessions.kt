package org.codetether.app.account

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.codetether.app.BuildConfig
import org.json.JSONObject

internal class AccountSessions(context: Context, private val http: AccountHttp) {
    private val store = EncryptedAccountStore(context)
    private val mutex = Mutex()
    private var loaded = false
    private var session: AccountSession? = null

    suspend fun restore(): AccountProfile? = mutex.withLock {
        loadIfNeeded()?.profile
    }

    suspend fun requestCode(value: String) {
        val email = normalizeEmail(value)
        try {
            request(
                "/auth/v1/otp",
                JSONObject().put("email", email).put("create_user", false),
            )
        } catch (status: HttpStatus) {
            throw AccountFailure(if (status.status == 429) AccountFailureReason.RATE_LIMITED else AccountFailureReason.SEND_CODE_FAILED)
        }
    }

    suspend fun verifyCode(value: String, code: String): AccountProfile {
        val email = normalizeEmail(value)
        val otp = code.trim()
        if (!otp.matches(OTP)) throw AccountFailure(AccountFailureReason.INVALID_CODE)
        return mutex.withLock {
            val response = try {
                request(
                    "/auth/v1/verify",
                    JSONObject().put("email", email).put("token", otp).put("type", "email"),
                )
            } catch (status: HttpStatus) {
                throw AccountFailure(if (status.status == 429) AccountFailureReason.RATE_LIMITED else AccountFailureReason.VERIFY_CODE_FAILED)
            }
            val verified = parseSession(response, fallbackEmail = email)
            persist(verified)
            verified.profile
        }
    }

    suspend fun current(): AccountSession = mutex.withLock {
        val existing = loadIfNeeded() ?: throw AccountFailure(AccountFailureReason.SIGN_IN_REQUIRED)
        val now = System.currentTimeMillis() / 1_000
        if (existing.expiresAt > now + REFRESH_MARGIN) return@withLock existing

        val response = try {
            request(
                "/auth/v1/token?grant_type=refresh_token",
                JSONObject().put("refresh_token", existing.refreshToken),
            )
        } catch (status: HttpStatus) {
            if (status.status !in setOf(400, 401, 403)) {
                throw AccountFailure(AccountFailureReason.REQUEST_FAILED)
            }
            clear()
            throw AccountFailure(AccountFailureReason.SIGN_IN_REQUIRED)
        }
        val refreshed = parseSession(response, fallbackEmail = existing.profile.email)
        if (refreshed.profile.id != existing.profile.id) {
            clear()
            throw AccountFailure(AccountFailureReason.SIGN_IN_REQUIRED)
        }
        persist(refreshed)
        refreshed
    }

    suspend fun clearLocalSession(): AccountSession? = mutex.withLock {
        val current = loadIfNeeded()
        clear()
        current
    }

    suspend fun endRemoteSession(existing: AccountSession?) {
        if (existing != null) {
            try {
                request("/auth/v1/logout?scope=local", JSONObject(), existing.accessToken)
            } catch (_: HttpStatus) {
                // The local encrypted session has already been cleared.
            } catch (_: AccountFailure) {
                // Network loss does not keep a local session alive.
            }
        }
    }

    private suspend fun loadIfNeeded(): AccountSession? {
        if (!loaded) {
            session = withContext(Dispatchers.IO) { store.load() }
            loaded = true
        }
        return session
    }

    private suspend fun clear() = withContext(Dispatchers.IO + NonCancellable) {
        store.clear()
        session = null
        loaded = true
    }

    private suspend fun persist(value: AccountSession) = withContext(Dispatchers.IO + NonCancellable) {
        store.save(value)
        session = value
        loaded = true
    }

    private suspend fun request(resource: String, body: JSONObject, accessToken: String? = null): JSONObject {
        val origin = configurationOrigin(BuildConfig.SUPABASE_URL)
        val key = BuildConfig.SUPABASE_PUBLISHABLE_KEY
        if (!isPublishableKeyConfigured(key)) {
            throw AccountFailure(AccountFailureReason.CONFIGURATION_MISSING)
        }
        return http.request(
            origin, resource, "POST",
            mapOf("apikey" to key, "Authorization" to "Bearer ${accessToken ?: key}"),
            body.toString().toByteArray(Charsets.UTF_8),
        )
    }

    private fun parseSession(response: JSONObject, fallbackEmail: String): AccountSession {
        val user = response.objectValue("user")
        val email = if (user.isNull("email")) fallbackEmail else user.stringValue("email", 320)
        val expiresAt = if (response.has("expires_at") && !response.isNull("expires_at")) {
            response.longValue("expires_at")
        } else {
            System.currentTimeMillis() / 1_000 + response.longValue("expires_in")
        }
        if (expiresAt <= System.currentTimeMillis() / 1_000) invalidResponse()
        return AccountSession(
            AccountProfile(user.stringValue("id"), email),
            response.stringValue("access_token", 8192).also(::validateToken),
            response.stringValue("refresh_token", 8192).also(::validateToken),
            expiresAt,
        )
    }

    private companion object {
        val EMAIL = Regex("^\\S+@\\S+\\.\\S+$")
        val OTP = Regex("^[0-9]{6,10}$")
        const val REFRESH_MARGIN = 30

        fun normalizeEmail(value: String): String = value.trim().also {
            if (it.length > 320 || !it.matches(EMAIL) || it.any { char -> char.isISOControl() }) {
                throw AccountFailure(AccountFailureReason.INVALID_EMAIL)
            }
        }

        fun validateToken(token: String) {
            if (token.any { it.code !in 33..126 }) invalidResponse()
        }
    }
}

internal fun isPublishableKeyConfigured(key: String): Boolean =
    key.isNotBlank() && key.length <= 2048 && key.all { it.code in 33..126 }
