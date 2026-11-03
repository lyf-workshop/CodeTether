package org.codetether.app.account

import android.content.Context
import android.os.Build
import java.net.URI
import java.time.Instant
import java.time.format.DateTimeParseException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.HttpUrl
import org.codetether.app.BuildConfig
import org.json.JSONObject
import uniffi.supervisor_mobile.ConnectionMode
import uniffi.supervisor_mobile.deviceRequestProof
import uniffi.supervisor_mobile.signCompactProof

internal class RegisteredDevice(
    val id: String,
    val ownerId: String,
    val generation: ULong,
    val fingerprint: String,
    val identity: AndroidDeviceIdentity,
)

internal class ControlPlane(private val context: Context, private val http: AccountHttp) {
    private val origin: HttpUrl get() = configurationOrigin(BuildConfig.CONTROL_PLANE_URL)

    suspend fun register(session: AccountSession): RegisteredDevice {
        val identity = withContext(Dispatchers.IO) { AndroidDeviceIdentity.loadOrCreate(context, session.profile.id) }
        // A stable public-key fingerprint reconciles an earlier registration after a lost response.
        val existing = request(session, "/v1/devices").arrayValue("devices")
        val matched = (0 until existing.length()).map { existing.optJSONObject(it) ?: invalidResponse() }
            .filter { it.opt("fingerprint") == identity.fingerprint }
        if (matched.size > 1) invalidResponse()
        matched.singleOrNull()?.let { return parseDevice(it, identity) }

        val platform = when (Build.SUPPORTED_ABIS.firstOrNull()) {
            "arm64-v8a" -> "Android-arm64"
            "x86_64" -> "Android-x64"
            else -> throw AccountFailure(AccountFailureReason.DEVICE_IDENTITY_UNAVAILABLE)
        }
        val deviceType = if (context.resources.configuration.smallestScreenWidthDp >= 600) "tablet" else "mobile"
        val label = Build.MODEL.trim().filterNot { it.isISOControl() }.take(120).ifEmpty { "Android" }
        val candidate = JSONObject()
            .put("publicKey", identity.publicJwk)
            .put("keyAlgorithm", "ES256")
            .put("deviceType", deviceType)
            .put("label", label)
            .put("platform", platform)
            .put("appVersion", BuildConfig.VERSION_NAME)
            .put("protocolVersion", 1)
        val response = request(session, "/v1/devices/registration-challenge", candidate)
        response.expect("publicKeyFingerprint", identity.fingerprint)
        val challenge = response.objectValue("challenge")
        validateChallenge(challenge, candidate, identity.fingerprint)
        val proof = sign {
            signCompactProof("codetether-device-registration+jws", challenge.toString(), identity)
        }
        val completion = request(
            session, "/v1/devices/register", JSONObject().put("challenge", challenge).put("proof", proof),
        ).objectValue("device")
        val registered = parseDevice(completion, identity)
        if (registered.id != challenge.idValue("candidateDeviceId", "dev_") ||
            registered.ownerId != challenge.idValue("userId", "usr_")
        ) invalidResponse()
        return registered
    }

    suspend fun directory(session: AccountSession, device: RegisteredDevice): List<PairedComputer> {
        val entries = request(session, "/v1/hosts/directory", device = device).arrayValue("hosts")
        val result = (0 until entries.length()).map { parseComputer(entries.optJSONObject(it) ?: invalidResponse(), device) }
        if (result.map { it.id }.toSet().size != result.size) invalidResponse()
        return result
    }

    suspend fun pair(
        session: suspend () -> AccountSession,
        device: RegisteredDevice,
        code: String,
        onClaimed: () -> Unit,
    ): PairingResult {
        val claim = request(
            session(), "/v1/pairing-sessions/redeem", JSONObject().put("code", code), device,
        )
        val status = claim.stringValue("status")
        if (status != "claimed") {
            val attempts = claim.longValue("remainingAttempts")
            if (attempts !in 0L..5L) invalidResponse()
            return PairingResult.Rejected(rejection(status), attempts.toInt())
        }
        val hostId = claim.idValue("hostId", "host_")
        val sessionId = claim.idValue("sessionId", "enroll_")
        val expiresAt = timestamp(claim.stringValue("expiresAt", 64))
        verifyPairingDevice(claim, device)
        onClaimed()

        val terminal = withTimeoutOrNull(330_000L) {
            waitForPairing(session, device, sessionId, hostId, expiresAt)
        } ?: PairingTerminal.Failure(PairingRejection.EXPIRED)
        if (terminal is PairingTerminal.Failure) return PairingResult.Rejected(terminal.reason, null)
        val authorizationId = (terminal as PairingTerminal.Success).authorizationId

        val computer = withTimeoutOrNull(25_000L) {
            waitForDirectoryEntry(session, device, hostId, authorizationId)
        } ?: throw AccountFailure(AccountFailureReason.COMPUTER_UNAVAILABLE)
        return PairingResult.Paired(computer)
    }

    suspend fun remove(session: AccountSession, device: RegisteredDevice, computer: PairedComputer) {
        val current = directory(session, device).firstOrNull { it.id == computer.id } ?: return
        val response = request(
            session, "/v1/hosts/${current.id}/device-authorization/revoke",
            JSONObject().put("authorizationId", current.authorizationId), device,
        )
        if (response.opt("result") !in setOf("revoked", "already_revoked")) invalidResponse()
        val authorization = response.objectValue("authorization")
        authorization.expect("authorizationId", current.authorizationId)
        authorization.expect("hostId", current.id)
        authorization.expect("deviceId", device.id)
    }

    private suspend fun waitForPairing(
        session: suspend () -> AccountSession,
        device: RegisteredDevice,
        sessionId: String,
        hostId: String,
        expiresAt: Instant,
    ): PairingTerminal {
        while (expiresAt.isAfter(Instant.now())) {
            delay(2_000L)
            val status = request(session(), "/v1/pairing-sessions/$sessionId", device = device)
            status.expect("sessionId", sessionId)
            status.expect("hostId", hostId)
            verifyPairingDevice(status, device)
            when (val name = status.stringValue("status")) {
                "claimed" -> Unit
                "paired" -> {
                    val authorization = status.objectValue("authorization")
                    authorization.expect("deviceId", device.id)
                    authorization.expect("hostId", hostId)
                    authorization.expect("scope", "supervisor_control")
                    return PairingTerminal.Success(authorization.idValue("authorizationId", "hauth_"))
                }
                else -> return PairingTerminal.Failure(rejection(name))
            }
        }
        return PairingTerminal.Failure(PairingRejection.EXPIRED)
    }

    private suspend fun waitForDirectoryEntry(
        session: suspend () -> AccountSession,
        device: RegisteredDevice,
        hostId: String,
        authorizationId: String,
    ): PairedComputer {
        while (true) {
            directory(session(), device).firstOrNull {
                it.id == hostId && it.authorizationId == authorizationId && it.allowsControl && it.isAvailable
            }?.let { return it }
            delay(2_000L)
        }
    }

    private suspend fun request(
        session: AccountSession,
        resource: String,
        body: JSONObject? = null,
        device: RegisteredDevice? = null,
    ): JSONObject {
        val bytes = body?.toString()?.toByteArray(Charsets.UTF_8)
        val method = if (body == null) "GET" else "POST"
        val headers = mutableMapOf("Authorization" to "Bearer ${session.accessToken}")
        if (device != null) {
            headers["x-codetether-device-proof"] = sign {
                deviceRequestProof(
                    session.accessToken, device.id, device.generation, method, resource, bytes ?: byteArrayOf(), device.identity,
                )
            }
        }
        return try {
            http.request(origin, resource, method, headers, bytes)
        } catch (status: HttpStatus) {
            throw AccountFailure(
                when (status.status) {
                    401 -> AccountFailureReason.SIGN_IN_REQUIRED
                    403 -> AccountFailureReason.AUTHORIZATION_UNAVAILABLE
                    429 -> AccountFailureReason.RATE_LIMITED
                    else -> AccountFailureReason.REQUEST_FAILED
                },
            )
        }
    }

    private fun parseDevice(json: JSONObject, identity: AndroidDeviceIdentity): RegisteredDevice {
        json.expect("keyAlgorithm", "ES256")
        json.expect("fingerprint", identity.fingerprint)
        val generation = json.longValue("keyGeneration")
        if (generation == 0L) invalidResponse()
        return RegisteredDevice(
            json.idValue("deviceId", "dev_"),
            json.idValue("ownerUserId", "usr_"),
            generation.toULong(),
            identity.fingerprint,
            identity,
        )
    }

    private fun parseComputer(json: JSONObject, device: RegisteredDevice): PairedComputer {
        val id = json.idValue("hostId", "host_")
        val fingerprint = json.stringValue("fingerprint", 128)
        val generation = json.longValue("identityGeneration").also { if (it == 0L) invalidResponse() }
        val publicKey = json.objectValue("publicKey")
        publicKey.expect("kty", "EC")
        publicKey.expect("crv", "P-256")
        for (coordinate in listOf("x", "y")) {
            if (!publicKey.stringValue(coordinate, 43).matches(COORDINATE)) invalidResponse()
        }
        val authorization = json.objectValue("authorization")
        authorization.expect("state", "authorized")
        val scope = authorization.stringValue("scope")
        if (scope !in setOf("supervisor_read", "supervisor_control")) invalidResponse()
        val expiresAt = authorization.stringValue("expiresAt", 64).also { timestamp(it) }
        val authorizationId = authorization.idValue("authorizationId", "hauth_")
        val supervisor = if (json.opt("supervisor") == JSONObject.NULL) null else json.objectValue("supervisor")
        val grant = supervisor?.objectValue("grant")
        val descriptor = supervisor?.objectValue("transport")
        if (grant != null && descriptor != null) {
            grant.stringValue("proof", 8192)
            descriptor.stringValue("proof", 8192)
            val grantPayload = grant.objectValue("payload")
            grantPayload.expect("purpose", "host_supervisor_grant")
            grantPayload.expect("authorizationId", authorizationId)
            grantPayload.expect("scope", scope)
            grantPayload.expect("hostId", id)
            grantPayload.expect("deviceId", device.id)
            grantPayload.expect("userId", device.ownerId)
            grantPayload.expect("deviceFingerprint", device.fingerprint)
            if (grantPayload.longValue("deviceKeyGeneration").toULong() != device.generation) invalidResponse()
            val descriptorPayload = descriptor.objectValue("payload")
            if (descriptorPayload.opt("purpose") !in setOf("host_supervisor_transport", "host_supervisor_presence")) invalidResponse()
            descriptorPayload.expect("hostId", id)
            descriptorPayload.expect("controlPlaneOrigin", origin.toString().removeSuffix("/"))
        }
        return PairedComputer(
            id, json.stringValue("safeLabel", 120), json.stringValue("coarsePlatform", 64),
            scope == "supervisor_control", expiresAt, authorizationId, fingerprint, generation.toULong(),
            publicKey.toString(), grant?.toString(), descriptor?.toString(),
        )
    }

    fun validateRelayConfig(computer: PairedComputer, mode: ConnectionMode) {
        if (mode == ConnectionMode.DIRECT) return
        val descriptor = computer.descriptorJson ?: throw AccountFailure(AccountFailureReason.COMPUTER_UNAVAILABLE)
        val relay = parseJson(descriptor).objectValue("payload").optJSONObject("relay")
        if (relay == null) {
            if (mode == ConnectionMode.RELAY) throw AccountFailure(AccountFailureReason.COMPUTER_UNAVAILABLE)
            return
        }
        val expected = listOf(BuildConfig.RELAY_ENDPOINT, BuildConfig.RELAY_ID, BuildConfig.RELAY_FINGERPRINT)
        if (expected.all { it.isBlank() }) return // The Rust core still verifies the signed descriptor pin.
        if (expected.any { it.isBlank() }) throw AccountFailure(AccountFailureReason.CONFIGURATION_MISSING)
        val receivedEndpoint = relay.stringValue("endpoint", 2048)
        if (!sameRelayEndpoint(receivedEndpoint, expected[0]) || relay.opt("relayId") != expected[1].trim() ||
            relay.opt("relayFingerprint") != expected[2].trim()
        ) throw AccountFailure(AccountFailureReason.COMPUTER_UNAVAILABLE)
    }

    private fun sameRelayEndpoint(received: String, configured: String): Boolean = try {
        URI(received.removeSuffix("/")) == URI(configured.trim().removeSuffix("/"))
    } catch (_: java.net.URISyntaxException) {
        false
    }

    private fun validateChallenge(challenge: JSONObject, candidate: JSONObject, fingerprint: String) {
        if (challenge.keys().asSequence().toSet() != CHALLENGE_FIELDS) invalidResponse()
        if (challenge.longValue("v") != 1L || challenge.longValue("protocolVersion") != 1L) invalidResponse()
        challenge.expect("aud", "codetether-control-plane")
        challenge.expect("purpose", "device_registration")
        challenge.expect("publicKeyFingerprint", fingerprint)
        for (field in listOf("keyAlgorithm", "deviceType", "label", "platform", "appVersion")) {
            challenge.expect(field, candidate.stringValue(field))
        }
        challenge.idValue("challengeId", "enroll_")
        challenge.idValue("userId", "usr_")
        challenge.idValue("candidateDeviceId", "dev_")
        if (!challenge.stringValue("nonce", 86).matches(CHALLENGE_NONCE)) invalidResponse()
        val now = System.currentTimeMillis() / 1_000
        val issuedAt = challenge.longValue("iat")
        val expiresAt = challenge.longValue("exp")
        if (issuedAt > now + 120 || expiresAt <= now || expiresAt - issuedAt !in 1..300) invalidResponse()
    }

    private fun verifyPairingDevice(value: JSONObject, device: RegisteredDevice) {
        if (!value.isNull("device")) value.objectValue("device").expect("deviceId", device.id)
    }

    private sealed interface PairingTerminal {
        class Success(val authorizationId: String) : PairingTerminal
        class Failure(val reason: PairingRejection) : PairingTerminal
    }

    private companion object {
        val CHALLENGE_NONCE = Regex("^[A-Za-z0-9_-]{22,86}$")
        val COORDINATE = Regex("^[A-Za-z0-9_-]{43}$")
        val CHALLENGE_FIELDS = setOf(
            "v", "aud", "purpose", "challengeId", "userId", "candidateDeviceId", "publicKeyFingerprint",
            "keyAlgorithm", "deviceType", "label", "platform", "appVersion", "nonce", "iat", "exp", "protocolVersion",
        )

        fun timestamp(value: String): Instant = try {
            Instant.parse(value)
        } catch (_: DateTimeParseException) {
            invalidResponse()
        }

        fun rejection(status: String): PairingRejection = when (status) {
            "invalid_code" -> PairingRejection.INVALID_CODE
            "expired" -> PairingRejection.EXPIRED
            "used" -> PairingRejection.USED
            "cancelled" -> PairingRejection.CANCELLED
            "rate_limited" -> PairingRejection.RATE_LIMITED
            else -> invalidResponse()
        }

        suspend fun sign(block: () -> String): String = withContext(Dispatchers.IO) {
            try {
                block()
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                throw AccountFailure(AccountFailureReason.DEVICE_IDENTITY_UNAVAILABLE)
            }
        }
    }
}
