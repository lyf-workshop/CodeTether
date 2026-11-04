import Foundation
import CoreFoundation
import Darwin
#if canImport(UIKit)
import UIKit
#endif

struct RegisteredDevice: Sendable {
    let id: String
    let ownerID: String
    let generation: UInt64
    let fingerprint: String
    let identity: DeviceIdentity
}

struct SupervisorConnectContext: Sendable {
    let session: AccountSession
    let device: RegisteredDevice
    let computer: PairedComputer
}

struct PairedComputer: Identifiable, Sendable {
    let id: String
    let name: String
    let platform: String
    let canControl: Bool
    let isAvailable: Bool
    let expiresAt: String
    let authorizationID: String
    let hostFingerprint: String
    let identityGeneration: UInt64
    let hostPublicJWKJSON: String
    let grantJSON: String?
    let descriptorJSON: String?
    let lastUsedAt: String?
}

protocol IpadMobileCrypto: Sendable {
    func signCompactProof(payloadJSON: String, identity: DeviceIdentity) async throws -> String
    func requestProof(
        accessToken: String,
        deviceID: String,
        keyGeneration: UInt64,
        method: String,
        resource: String,
        body: Data,
        identity: DeviceIdentity
    ) async throws -> String
}

actor AccountClient {
    private let configuration: IpadConfiguration
    private let crypto: IpadMobileCrypto
    private let sessionStore = AccountSessionStore()
    private let http = AccountHTTP()
    private var restored = false
    private var accountSession: AccountSession?
    private var registeredDevice: RegisteredDevice?
    private var computersByID: [String: PairedComputer] = [:]

    init(configuration: IpadConfiguration, crypto: IpadMobileCrypto) {
        self.configuration = configuration
        self.crypto = crypto
    }

    func restore() async throws -> AccountProfile? {
        guard let value = try await loadSession() else { return nil }
        return try await refreshIfNeeded(value).profile
    }

    func requestSignInCode(email input: String) async throws {
        let email = try Self.normalizedEmail(input)
        do {
            _ = try await authRequest("/auth/v1/otp", body: ["email": email, "create_user": false])
        } catch let error as HTTPStatusError {
            throw error.status == 429 ? ClientFailure.requestRateLimited : ClientFailure.sendCodeFailed
        }
    }

    func verifySignInCode(email input: String, code inputCode: String) async throws -> AccountProfile {
        let email = try Self.normalizedEmail(input)
        let code = inputCode.trimmingCharacters(in: .whitespacesAndNewlines)
        guard code.range(of: "^[0-9]{6,10}$", options: .regularExpression) != nil else { throw ClientFailure.invalidCode }
        do {
            let response = try await authRequest("/auth/v1/verify", body: ["email": email, "token": code, "type": "email"])
            let verified = try Self.parseSession(response, fallbackEmail: email)
            let store = sessionStore
            try await Task.detached { try store.save(verified) }.value
            accountSession = verified
            registeredDevice = nil
            restored = true
            return verified.profile
        } catch let error as HTTPStatusError {
            throw error.status == 429 ? ClientFailure.requestRateLimited : ClientFailure.verifyCodeFailed
        }
    }

    func currentSession() async throws -> AccountSession {
        guard let value = try await loadSession() else { throw ClientFailure.signInRequired }
        return try await refreshIfNeeded(value)
    }

    func signOut() async {
        let old = accountSession
        let store = sessionStore
        do { try await Task.detached { try store.clear() }.value } catch { }
        accountSession = nil
        registeredDevice = nil
        computersByID = [:]
        restored = true
        guard let old else { return }
        do {
            _ = try await authRequest("/auth/v1/logout?scope=local", body: [:], accessToken: old.accessToken)
        } catch { }
    }

    func directory() async throws -> [PairedComputer] {
        let session = try await currentSession()
        let device = try await ensureRegistered(session)
        let data = try await requestJSON("/v1/hosts/directory", method: "GET", session: session, device: device)
        guard let rows = data["hosts"] as? [[String: Any]], rows.count <= 256 else { throw ClientFailure.invalidResponse }
        let values = try rows.map { try parseComputer($0, device: device) }
        guard Set(values.map(\.id)).count == values.count else { throw ClientFailure.invalidResponse }
        computersByID = Dictionary(uniqueKeysWithValues: values.map { ($0.id, $0) })
        return values
    }

    func connectContext(computerID: String, mode: TabletConnectionMode) async throws -> SupervisorConnectContext {
        let session = try await currentSession()
        let values = try await directory()
        guard let computer = values.first(where: { $0.id == computerID }) else { throw ClientFailure.computerRemoved }
        guard computer.canControl else { throw ClientFailure.operationNotAllowed }
        guard computer.isAvailable, let device = registeredDevice else { throw ClientFailure.computerUnavailable }
        try validateRelayConfiguration(computer, mode: mode)
        return SupervisorConnectContext(session: session, device: device, computer: computer)
    }

    func pair(code input: String, onClaimed: @Sendable () -> Void) async throws -> PairedComputer {
        let code = input.filter { !$0.isWhitespace }
        guard code.range(of: "^[0-9]{6}$", options: .regularExpression) != nil else { throw ClientFailure.pairingInvalid(0) }
        let session = try await currentSession()
        let device = try await ensureRegistered(session)
        let claim = try await requestJSON(
            "/v1/pairing-sessions/redeem", method: "POST", body: ["code": code], session: session, device: device
        )
        let status = try Self.string(claim, "status", max: 40)
        guard status == "claimed" else {
            let attempts = claim["remainingAttempts"] as? Int ?? 0
            if attempts == 0 || status == "rate_limited" { throw ClientFailure.pairingRateLimited }
            switch status {
            case "invalid_code": throw ClientFailure.pairingInvalid(attempts)
            case "expired": throw ClientFailure.pairingExpired
            case "used": throw ClientFailure.pairingUsed
            case "cancelled": throw ClientFailure.pairingCancelled
            default: throw ClientFailure.invalidResponse
            }
        }
        let hostID = try Self.identifier(claim, "hostId", prefix: "host_")
        let sessionID = try Self.identifier(claim, "sessionId", prefix: "enroll_")
        let expiryText = try Self.string(claim, "expiresAt", max: 64)
        guard let expiry = ISO8601DateFormatter().date(from: expiryText), expiry > Date() else { throw ClientFailure.pairingExpired }
        if let claimedDevice = claim["device"] as? [String: Any], claimedDevice["deviceId"] as? String != device.id {
            throw ClientFailure.invalidResponse
        }
        onClaimed()

        var paired = false
        let pairingDeadline = min(expiry, Date().addingTimeInterval(330))
        while Date() < pairingDeadline {
            try Task.checkCancellation()
            try await Task.sleep(nanoseconds: 2_000_000_000)
            let result = try await requestJSON("/v1/pairing-sessions/\(sessionID)", method: "GET", session: session, device: device)
            guard result["sessionId"] as? String == sessionID, result["hostId"] as? String == hostID else {
                throw ClientFailure.invalidResponse
            }
            if let claimedDevice = result["device"] as? [String: Any], claimedDevice["deviceId"] as? String != device.id {
                throw ClientFailure.invalidResponse
            }
            switch result["status"] as? String {
            case "claimed": continue
            case "paired": paired = true
            case "expired": throw ClientFailure.pairingExpired
            case "used": throw ClientFailure.pairingUsed
            case "cancelled": throw ClientFailure.pairingCancelled
            case "rate_limited": throw ClientFailure.pairingRateLimited
            default: throw ClientFailure.invalidResponse
            }
            if paired { break }
        }
        guard paired else { throw ClientFailure.pairingExpired }

        let directoryDeadline = Date().addingTimeInterval(25)
        while Date() < directoryDeadline {
            try Task.checkCancellation()
            let values = try await directory()
            if let computer = values.first(where: { $0.id == hostID && $0.canControl && $0.isAvailable }) {
                return computer
            }
            try await Task.sleep(nanoseconds: 2_000_000_000)
        }
        throw ClientFailure.computerUnavailable
    }

    func remove(computerID: String) async throws {
        let session = try await currentSession()
        let device = try await ensureRegistered(session)
        guard let current = try await directory().first(where: { $0.id == computerID }) else { return }
        let response = try await requestJSON(
            "/v1/hosts/\(current.id)/device-authorization/revoke", method: "POST",
            body: ["authorizationId": current.authorizationID], session: session, device: device
        )
        guard let result = response["result"] as? String, ["revoked", "already_revoked"].contains(result),
              let authorization = response["authorization"] as? [String: Any],
              authorization["authorizationId"] as? String == current.authorizationID,
              authorization["hostId"] as? String == current.id,
              authorization["deviceId"] as? String == device.id else { throw ClientFailure.invalidResponse }
    }

    private func loadSession() async throws -> AccountSession? {
        if restored { return accountSession }
        let value = try await Task.detached { try self.sessionStore.load() }.value
        accountSession = value
        restored = true
        return value
    }

    private func refreshIfNeeded(_ value: AccountSession) async throws -> AccountSession {
        if value.expiresAt > Int64(Date().timeIntervalSince1970) + 30 { return value }
        do {
            let response = try await authRequest(
                "/auth/v1/token?grant_type=refresh_token", body: ["refresh_token": value.refreshToken]
            )
            let next = try Self.parseSession(response, fallbackEmail: value.profile.email)
            guard next.profile.id == value.profile.id else { throw ClientFailure.signInRequired }
            let store = sessionStore
            try await Task.detached { try store.save(next) }.value
            accountSession = next
            return next
        } catch let error as HTTPStatusError where [400, 401, 403].contains(error.status) {
            let store = sessionStore
            try? await Task.detached { try store.clear() }.value
            accountSession = nil
            registeredDevice = nil
            throw ClientFailure.signInRequired
        }
    }

    private func ensureRegistered(_ session: AccountSession) async throws -> RegisteredDevice {
        if let current = registeredDevice, current.ownerID == session.profile.id { return current }
        let accountID = session.profile.id
        let identity = try await Task.detached { try DeviceIdentity.loadOrCreate(accountID: accountID) }.value
        let rows = try await requestJSON("/v1/devices", method: "GET", session: session)
        guard let devices = rows["devices"] as? [[String: Any]], devices.count <= 256 else { throw ClientFailure.invalidResponse }
        let matches = devices.filter { $0["fingerprint"] as? String == identity.fingerprint }
        guard matches.count <= 1 else { throw ClientFailure.invalidResponse }
        if let match = matches.first {
            let device = try parseRegisteredDevice(match, identity: identity)
            registeredDevice = device
            return device
        }

        let platform: String
        #if targetEnvironment(simulator)
        platform = "iPadOS-Simulator-arm64"
        #else
        platform = "iPadOS-arm64"
        #endif
        let label = ipadModelName()
        let candidate: [String: Any] = [
            "publicKey": identity.publicJWK, "keyAlgorithm": "ES256", "deviceType": "tablet",
            "label": label, "platform": platform, "appVersion": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.1.0",
            "protocolVersion": 1,
        ]
        let challengeResponse = try await requestJSON("/v1/devices/registration-challenge", method: "POST", body: candidate, session: session)
        guard challengeResponse["publicKeyFingerprint"] as? String == identity.fingerprint,
              let challenge = challengeResponse["challenge"] as? [String: Any] else { throw ClientFailure.invalidResponse }
        try validateChallenge(challenge, candidate: candidate, fingerprint: identity.fingerprint)
        let challengeData = try Self.jsonData(challenge)
        guard let payload = String(data: challengeData, encoding: .utf8) else { throw ClientFailure.invalidResponse }
        let proof = try await crypto.signCompactProof(payloadJSON: payload, identity: identity)
        let completion = try await requestJSON(
            "/v1/devices/register", method: "POST", body: ["challenge": challenge, "proof": proof], session: session
        )
        guard let object = completion["device"] as? [String: Any] else { throw ClientFailure.invalidResponse }
        let registered = try parseRegisteredDevice(object, identity: identity)
        guard registered.id == (challenge["candidateDeviceId"] as? String),
              registered.ownerID == (challenge["userId"] as? String) else { throw ClientFailure.invalidResponse }
        registeredDevice = registered
        return registered
    }

    private func parseRegisteredDevice(_ object: [String: Any], identity: DeviceIdentity) throws -> RegisteredDevice {
        guard object["keyAlgorithm"] as? String == "ES256", object["fingerprint"] as? String == identity.fingerprint else {
            throw ClientFailure.invalidResponse
        }
        return RegisteredDevice(
            id: try Self.identifier(object, "deviceId", prefix: "dev_"),
            ownerID: try Self.identifier(object, "ownerUserId", prefix: "usr_"),
            generation: try Self.positiveInteger(object, "keyGeneration"),
            fingerprint: identity.fingerprint,
            identity: identity
        )
    }

    private func parseComputer(_ object: [String: Any], device: RegisteredDevice) throws -> PairedComputer {
        let id = try Self.identifier(object, "hostId", prefix: "host_")
        let fingerprint = try Self.string(object, "fingerprint", max: 128)
        let generation = try Self.positiveInteger(object, "identityGeneration")
        guard let publicKey = object["publicKey"] as? [String: Any], publicKey["kty"] as? String == "EC",
              publicKey["crv"] as? String == "P-256",
              ["x", "y"].allSatisfy({ ($0 == "x" ? publicKey["x"] : publicKey["y"]) as? String != nil }) else {
            throw ClientFailure.invalidResponse
        }
        guard let authorization = object["authorization"] as? [String: Any], authorization["state"] as? String == "authorized",
              let scope = authorization["scope"] as? String, ["supervisor_read", "supervisor_control"].contains(scope) else {
            throw ClientFailure.invalidResponse
        }
        let authorizationID = try Self.identifier(authorization, "authorizationId", prefix: "hauth_")
        let expiresAt = try Self.string(authorization, "expiresAt", max: 64)
        guard ISO8601DateFormatter().date(from: expiresAt) != nil else { throw ClientFailure.invalidResponse }

        var grantJSON: String?
        var descriptorJSON: String?
        if let supervisor = object["supervisor"] as? [String: Any],
           let grant = supervisor["grant"] as? [String: Any],
           let descriptor = supervisor["transport"] as? [String: Any] {
            guard let grantPayload = grant["payload"] as? [String: Any],
                  grantPayload["purpose"] as? String == "host_supervisor_grant",
                  grantPayload["authorizationId"] as? String == authorizationID,
                  grantPayload["scope"] as? String == scope,
                  grantPayload["hostId"] as? String == id,
                  grantPayload["deviceId"] as? String == device.id,
                  grantPayload["userId"] as? String == device.ownerID,
                  grantPayload["deviceFingerprint"] as? String == device.fingerprint,
                  (grantPayload["deviceKeyGeneration"] as? NSNumber)?.uint64Value == device.generation,
                  let descriptorPayload = descriptor["payload"] as? [String: Any],
                  ["host_supervisor_transport", "host_supervisor_presence"].contains(descriptorPayload["purpose"] as? String ?? ""),
                  descriptorPayload["hostId"] as? String == id,
                  descriptorPayload["controlPlaneOrigin"] as? String == configuration.controlPlaneURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")) else {
                throw ClientFailure.invalidResponse
            }
            grantJSON = try Self.jsonString(grant)
            descriptorJSON = try Self.jsonString(descriptor)
        }
        let label = (object["safeLabel"] as? String).flatMap { $0 == "CodeTether Host" ? nil : $0 } ?? "这台电脑"
        return PairedComputer(
            id: id, name: label, platform: try Self.string(object, "coarsePlatform", max: 64),
            canControl: scope == "supervisor_control", isAvailable: descriptorJSON != nil,
            expiresAt: expiresAt, authorizationID: authorizationID, hostFingerprint: fingerprint,
            identityGeneration: generation, hostPublicJWKJSON: try Self.jsonString(publicKey),
            grantJSON: grantJSON, descriptorJSON: descriptorJSON, lastUsedAt: object["lastUsedAt"] as? String
        )
    }

    private func validateChallenge(_ challenge: [String: Any], candidate: [String: Any], fingerprint: String) throws {
        let fields: Set<String> = ["v", "aud", "purpose", "challengeId", "userId", "candidateDeviceId", "publicKeyFingerprint", "keyAlgorithm", "deviceType", "label", "platform", "appVersion", "nonce", "iat", "exp", "protocolVersion"]
        guard Set(challenge.keys) == fields,
              (challenge["v"] as? Int) == 1, (challenge["protocolVersion"] as? Int) == 1,
              challenge["aud"] as? String == "codetether-control-plane",
              challenge["purpose"] as? String == "device_registration",
              challenge["publicKeyFingerprint"] as? String == fingerprint,
              ["keyAlgorithm", "deviceType", "label", "platform", "appVersion"].allSatisfy({ challenge[$0] as? String == candidate[$0] as? String }),
              (challenge["nonce"] as? String)?.range(of: "^[A-Za-z0-9_-]{22,86}$", options: .regularExpression) != nil else {
            throw ClientFailure.invalidResponse
        }
        _ = try Self.identifier(challenge, "challengeId", prefix: "enroll_")
        _ = try Self.identifier(challenge, "userId", prefix: "usr_")
        _ = try Self.identifier(challenge, "candidateDeviceId", prefix: "dev_")
        let issuedAt = try Self.nonnegativeInteger(challenge, "iat")
        let expiresAt = try Self.nonnegativeInteger(challenge, "exp")
        let now = Int64(Date().timeIntervalSince1970)
        guard issuedAt <= now + 120, expiresAt > now, expiresAt - issuedAt >= 1, expiresAt - issuedAt <= 300 else {
            throw ClientFailure.invalidResponse
        }
    }

    private func authRequest(_ path: String, body: [String: Any], accessToken: String? = nil) async throws -> [String: Any] {
        guard Self.isPublishableKeyConfigured(configuration.publishableKey) else { throw ClientFailure.configurationMissing }
        let headers = [
            "apikey": configuration.publishableKey,
            "Authorization": "Bearer \(accessToken ?? configuration.publishableKey)",
        ]
        return try await request(
            origin: configuration.supabaseURL, path: path, method: "POST", body: try Self.jsonData(body), headers: headers
        )
    }

    private func requestJSON(
        _ path: String,
        method: String,
        body: [String: Any]? = nil,
        session: AccountSession,
        device: RegisteredDevice? = nil
    ) async throws -> [String: Any] {
        let bytes = try body.map(Self.jsonData) ?? Data()
        var activeSession = session
        for attempt in 0...1 {
            var headers = ["Authorization": "Bearer \(activeSession.accessToken)"]
            if let device {
                headers["x-codetether-device-proof"] = try await crypto.requestProof(
                    accessToken: activeSession.accessToken, deviceID: device.id, keyGeneration: device.generation,
                    method: method, resource: path, body: bytes, identity: device.identity
                )
            }
            do {
                return try await request(
                    origin: configuration.controlPlaneURL, path: path, method: method,
                    body: body == nil ? nil : bytes, headers: headers
                )
            } catch let error as HTTPStatusError where error.status == 401 {
                if attempt == 0 {
                    activeSession = try await refreshAfterUnauthorized(activeSession)
                } else {
                    await clearLocalSession()
                    throw ClientFailure.signInRequired
                }
            }
        }
        throw ClientFailure.requestFailed
    }

    private func refreshAfterUnauthorized(_ stale: AccountSession) async throws -> AccountSession {
        do {
            let response = try await authRequest(
                "/auth/v1/token?grant_type=refresh_token", body: ["refresh_token": stale.refreshToken]
            )
            let refreshed = try Self.parseSession(response, fallbackEmail: stale.profile.email)
            guard refreshed.profile.id == stale.profile.id else { throw ClientFailure.signInRequired }
            let store = sessionStore
            try await Task.detached { try store.save(refreshed) }.value
            accountSession = refreshed
            return refreshed
        } catch let error as HTTPStatusError where [400, 401, 403].contains(error.status) {
            await clearLocalSession()
            throw ClientFailure.signInRequired
        } catch let error as HTTPStatusError where error.status == 429 {
            throw ClientFailure.requestRateLimited
        } catch let error as ClientFailure {
            if case .signInRequired = error { await clearLocalSession() }
            throw error
        }
    }

    private func clearLocalSession() async {
        let store = sessionStore
        try? await Task.detached { try store.clear() }.value
        accountSession = nil
        registeredDevice = nil
        computersByID = [:]
        restored = true
    }

    private func request(
        origin: URL,
        path: String,
        method: String,
        body: Data?,
        headers: [String: String]
    ) async throws -> [String: Any] {
        guard path.hasPrefix("/"), let url = URL(string: path, relativeTo: origin)?.absoluteURL,
              url.scheme == "https", url.host == origin.host, url.port == origin.port else {
            throw ClientFailure.configurationMissing
        }
        var request = URLRequest(url: url, timeoutInterval: 12)
        request.httpMethod = method
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if body != nil { request.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type") }
        headers.forEach { request.setValue($1, forHTTPHeaderField: $0) }
        do {
            let (bytes, response) = try await http.session.bytes(for: request)
            guard let response = response as? HTTPURLResponse else { throw ClientFailure.requestFailed }
            var data = Data()
            for try await byte in bytes {
                data.append(byte)
                if data.count > 2 * 1024 * 1024 { throw ClientFailure.invalidResponse }
            }
            guard (200..<300).contains(response.statusCode) else { throw HTTPStatusError(response.statusCode) }
            if data.isEmpty { return [:] }
            guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw ClientFailure.invalidResponse }
            return json
        } catch let error as HTTPStatusError {
            throw error
        } catch let error as ClientFailure {
            throw error
        } catch {
            throw ClientFailure.requestFailed
        }
    }

    private static func parseSession(_ response: [String: Any], fallbackEmail: String) throws -> AccountSession {
        guard let user = response["user"] as? [String: Any],
              let id = user["id"] as? String, !id.isEmpty,
              let access = response["access_token"] as? String, Self.validToken(access),
              let refresh = response["refresh_token"] as? String, Self.validToken(refresh) else { throw ClientFailure.invalidResponse }
        let email = (user["email"] as? String) ?? fallbackEmail
        let expiry = (response["expires_at"] as? NSNumber)?.int64Value ??
            Int64(Date().timeIntervalSince1970) + ((response["expires_in"] as? NSNumber)?.int64Value ?? 0)
        guard expiry > Int64(Date().timeIntervalSince1970) else { throw ClientFailure.invalidResponse }
        return AccountSession(profile: AccountProfile(id: id, email: email), accessToken: access, refreshToken: refresh, expiresAt: expiry)
    }

    private static func normalizedEmail(_ value: String) throws -> String {
        let email = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard email.utf8.count <= 320, email.range(of: "^\\S+@\\S+\\.\\S+$", options: .regularExpression) != nil,
              email.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) }) else { throw ClientFailure.invalidEmail }
        return email
    }

    private static func validToken(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.count <= 8_192 && value.utf8.allSatisfy { $0 >= 33 && $0 <= 126 }
    }

    private static func isPublishableKeyConfigured(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.count <= 2_048 && value.utf8.allSatisfy { $0 >= 33 && $0 <= 126 }
    }

    private static func jsonData(_ value: [String: Any]) throws -> Data {
        do { return try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) }
        catch { throw ClientFailure.invalidResponse }
    }

    private static func jsonString(_ value: [String: Any]) throws -> String {
        guard let text = String(data: try jsonData(value), encoding: .utf8) else { throw ClientFailure.invalidResponse }
        return text
    }

    private static func string(_ object: [String: Any], _ key: String, max: Int) throws -> String {
        guard let value = object[key] as? String, !value.isEmpty, value.utf8.count <= max,
              value.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) }) else { throw ClientFailure.invalidResponse }
        return value
    }

    private static func identifier(_ object: [String: Any], _ key: String, prefix: String) throws -> String {
        let value = try string(object, key, max: 160)
        guard value.hasPrefix(prefix), value.count > prefix.count,
              value.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil else { throw ClientFailure.invalidResponse }
        return value
    }

    private static func positiveInteger(_ object: [String: Any], _ key: String) throws -> UInt64 {
        let value = try nonnegativeInteger(object, key)
        guard value > 0 else { throw ClientFailure.invalidResponse }
        return UInt64(value)
    }

    private static func nonnegativeInteger(_ object: [String: Any], _ key: String) throws -> Int64 {
        guard let number = object[key] as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { throw ClientFailure.invalidResponse }
        let value = number.int64Value
        guard value >= 0, number.doubleValue == Double(value) else { throw ClientFailure.invalidResponse }
        return value
    }

    func validateRelayConfiguration(_ computer: PairedComputer, mode: TabletConnectionMode) throws {
        guard mode != .direct else { return }
        guard let descriptor = computer.descriptorJSON else { throw ClientFailure.computerUnavailable }
        guard let data = descriptor.data(using: .utf8),
              let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let payload = root["payload"] as? [String: Any] else { throw ClientFailure.invalidResponse }
        guard let relay = payload["relay"] as? [String: Any] else {
            if mode == .relay { throw ClientFailure.computerUnavailable }
            return
        }
        guard let endpoint = configuration.relayEndpoint,
              let relayID = configuration.relayID,
              let fingerprint = configuration.relayFingerprint else { return }
        guard relay["endpoint"] as? String == endpoint, relay["relayId"] as? String == relayID,
              relay["relayFingerprint"] as? String == fingerprint else { throw ClientFailure.computerUnavailable }
    }

    private func ipadModelName() -> String {
        #if targetEnvironment(simulator)
        let identifier = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] ?? "Simulator"
        #else
        var size = 0
        sysctlbyname("hw.machine", nil, &size, nil, 0)
        var bytes = [CChar](repeating: 0, count: max(size, 1))
        sysctlbyname("hw.machine", &bytes, &size, nil, 0)
        let identifier = String(cString: bytes)
        #endif
        return "iPad (\(identifier))"
    }
}

private final class AccountHTTP: @unchecked Sendable {
    let session: URLSession

    init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 12
        configuration.timeoutIntervalForResource = 15
        configuration.httpShouldSetCookies = false
        session = URLSession(configuration: configuration, delegate: NoRedirectDelegate(), delegateQueue: nil)
    }
}

private final class NoRedirectDelegate: NSObject, URLSessionTaskDelegate {
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}

private struct HTTPStatusError: Error {
    let status: Int
    init(_ status: Int) { self.status = status }
}

