import CryptoKit
import Foundation
import Security

struct AccountProfile: Codable, Equatable, Sendable {
    let id: String
    let email: String
}

struct AccountSession: Codable, Equatable, Sendable {
    let profile: AccountProfile
    let accessToken: String
    let refreshToken: String
    let expiresAt: Int64
}

enum KeychainStore {
    static func read(service: String, account: String) throws -> Data? {
        var query = baseQuery(service: service, account: account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw ClientFailure.requestFailed }
        return data
    }

    static func save(_ data: Data, service: String, account: String) throws {
        let query = baseQuery(service: service, account: account)
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        ]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var insertion = query
            attributes.forEach { insertion[$0.key] = $0.value }
            guard SecItemAdd(insertion as CFDictionary, nil) == errSecSuccess else { throw ClientFailure.requestFailed }
        } else if status != errSecSuccess {
            throw ClientFailure.requestFailed
        }
    }

    static func delete(service: String, account: String) throws {
        let status = SecItemDelete(baseQuery(service: service, account: account) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw ClientFailure.requestFailed }
    }

    private static func baseQuery(service: String, account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }
}

final class AccountSessionStore: @unchecked Sendable {
    private let service = "org.codetether.app.account.v1"

    func load() throws -> AccountSession? {
        guard let data = try KeychainStore.read(service: service, account: "current") else { return nil }
        do { return try JSONDecoder().decode(AccountSession.self, from: data) }
        catch { throw ClientFailure.invalidResponse }
    }

    func save(_ session: AccountSession) throws {
        let data: Data
        do { data = try JSONEncoder().encode(session) }
        catch { throw ClientFailure.invalidResponse }
        try KeychainStore.save(data, service: service, account: "current")
    }

    func clear() throws {
        try KeychainStore.delete(service: service, account: "current")
    }
}

final class DeviceIdentity: @unchecked Sendable {
    enum Protection: String {
        case secureEnclave
        case softwareDebugSimulator
    }

    let protection: Protection
    let publicJWK: [String: String]
    let publicJWKJSON: String
    let fingerprint: String
    private let privateKey: SecKey

    private init(privateKey: SecKey, protection: Protection) throws {
        self.privateKey = privateKey
        self.protection = protection
        guard let publicKey = SecKeyCopyPublicKey(privateKey),
              let raw = SecKeyCopyExternalRepresentation(publicKey, nil) as Data?, raw.count == 65, raw[0] == 4 else {
            throw ClientFailure.deviceIdentityUnavailable
        }
        let x = Self.base64URL(raw.subdata(in: 1..<33))
        let y = Self.base64URL(raw.subdata(in: 33..<65))
        let jwk = ["crv": "P-256", "kty": "EC", "x": x, "y": y]
        let canonical = "{\"crv\":\"P-256\",\"kty\":\"EC\",\"x\":\"\(x)\",\"y\":\"\(y)\"}"
        publicJWK = jwk
        publicJWKJSON = canonical
        let digest = SHA256.hash(data: Data(canonical.utf8))
        fingerprint = "sha256:" + Self.base64URL(Data(digest))
    }

    static func loadOrCreate(accountID: String) throws -> DeviceIdentity {
        let tag = Data("org.codetether.app.device.v1.\(SHA256.hash(data: Data(accountID.utf8)).map { String(format: "%02x", $0) }.joined())".utf8)
        if let existing = try findPrivateKey(tag: tag) {
            #if targetEnvironment(simulator)
            #if DEBUG
            return try DeviceIdentity(privateKey: existing, protection: .softwareDebugSimulator)
            #else
            throw ClientFailure.deviceIdentityUnavailable
            #endif
            #else
            let keyAttributes = SecKeyCopyAttributes(existing) as? [String: Any]
            guard keyAttributes?[kSecAttrTokenID as String] as? String == (kSecAttrTokenIDSecureEnclave as String) else {
                throw ClientFailure.deviceIdentityUnavailable
            }
            return try DeviceIdentity(privateKey: existing, protection: .secureEnclave)
            #endif
        }

        #if targetEnvironment(simulator)
        #if DEBUG
        let protection = Protection.softwareDebugSimulator
        let attributes: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits as String: 256,
            kSecPrivateKeyAttrs as String: [
                kSecAttrIsPermanent as String: true,
                kSecAttrApplicationTag as String: tag,
                kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            ],
        ]
        #else
        throw ClientFailure.deviceIdentityUnavailable
        #endif
        #else
        let protection = Protection.secureEnclave
        var accessError: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(
            nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, [.privateKeyUsage], &accessError
        ) else { throw ClientFailure.deviceIdentityUnavailable }
        let attributes: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits as String: 256,
            kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
            kSecPrivateKeyAttrs as String: [
                kSecAttrIsPermanent as String: true,
                kSecAttrApplicationTag as String: tag,
                kSecAttrAccessControl as String: access,
            ],
        ]
        #endif

        var keyError: Unmanaged<CFError>?
        guard let key = SecKeyCreateRandomKey(attributes as CFDictionary, &keyError) else {
            throw ClientFailure.deviceIdentityUnavailable
        }
        return try DeviceIdentity(privateKey: key, protection: protection)
    }

    func signDER(_ message: Data) throws -> Data {
        var error: Unmanaged<CFError>?
        guard let signature = SecKeyCreateSignature(
            privateKey, .ecdsaSignatureMessageX962SHA256, message as CFData, &error
        ) as Data? else { throw ClientFailure.deviceIdentityUnavailable }
        return signature
    }

    private static func findPrivateKey(tag: Data) throws -> SecKey? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassKey,
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrApplicationTag as String: tag,
            kSecReturnRef as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let result,
              CFGetTypeID(result) == SecKeyGetTypeID() else {
            throw ClientFailure.deviceIdentityUnavailable
        }
        return unsafeBitCast(result, to: SecKey.self)
    }

    private static func base64URL(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}
