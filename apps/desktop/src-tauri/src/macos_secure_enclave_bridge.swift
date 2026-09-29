import CryptoKit
import Foundation
import Security

private let productDeviceService = "CodeTether.ProductDevice"

private let success: Int32 = 0
private let notFound: Int32 = 1
private let storageFailure: Int32 = 2
private let secureStorageUnavailable: Int32 = 3
private let operationFailure: Int32 = 4
private let invalidInput: Int32 = 5
private let accessDenied: Int32 = 6

private struct BridgeError: Error {
    let code: Int32
}

private func accountString(_ account: UnsafePointer<CChar>?) -> String? {
    guard let account else { return nil }
    return String(cString: account)
}

private func keychainQuery(account: String, returningData: Bool) -> [String: Any] {
    var query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: productDeviceService,
        kSecAttrAccount as String: account,
        kSecAttrSynchronizable as String: false,
    ]
    if returningData {
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
    }
    return query
}

private func mapKeychainStatus(_ status: OSStatus) -> Int32 {
    switch status {
    case errSecItemNotFound:
        return notFound
    case errSecAuthFailed, errSecInteractionNotAllowed:
        return accessDenied
    default:
        return storageFailure
    }
}

private func loadWrappedRepresentation(account: String) -> Result<Data, BridgeError> {
    var result: CFTypeRef?
    let status = SecItemCopyMatching(keychainQuery(account: account, returningData: true) as CFDictionary, &result)
    guard status == errSecSuccess else {
        return .failure(BridgeError(code: mapKeychainStatus(status)))
    }
    guard let data = result as? Data, !data.isEmpty else {
        return .failure(BridgeError(code: operationFailure))
    }
    return .success(data)
}

private func storeWrappedRepresentation(_ representation: Data, account: String) -> Int32 {
    var query = keychainQuery(account: account, returningData: false)
    query[kSecValueData as String] = representation
    let status = SecItemAdd(query as CFDictionary, nil)
    guard status == errSecSuccess else {
        return mapKeychainStatus(status)
    }
    return success
}

private func deleteWrappedRepresentation(account: String) -> Int32 {
    let status = SecItemDelete(keychainQuery(account: account, returningData: false) as CFDictionary)
    guard status == errSecSuccess else {
        return mapKeychainStatus(status)
    }
    return success
}

private func copyBytes(_ data: Data, into output: UnsafeMutablePointer<UInt8>?, count: Int) -> Bool {
    guard data.count == count, let output else { return false }
    data.copyBytes(to: output, count: count)
    return true
}

@_cdecl("codetether_secure_enclave_create")
public func codetetherSecureEnclaveCreate(
    _ account: UnsafePointer<CChar>?,
    _ publicKey: UnsafeMutablePointer<UInt8>?
) -> Int32 {
    guard let account = accountString(account), !account.isEmpty else {
        return invalidInput
    }
    guard SecureEnclave.isAvailable else {
        return secureStorageUnavailable
    }
    do {
        let key = try SecureEnclave.P256.Signing.PrivateKey()
        let representation = key.dataRepresentation
        let storeResult = storeWrappedRepresentation(representation, account: account)
        guard storeResult == success else { return storeResult }
        guard copyBytes(key.publicKey.rawRepresentation, into: publicKey, count: 64) else {
            _ = deleteWrappedRepresentation(account: account)
            return operationFailure
        }
        return success
    } catch {
        return secureStorageUnavailable
    }
}

@_cdecl("codetether_secure_enclave_public_key")
public func codetetherSecureEnclavePublicKey(
    _ account: UnsafePointer<CChar>?,
    _ publicKey: UnsafeMutablePointer<UInt8>?
) -> Int32 {
    guard let account = accountString(account), !account.isEmpty else {
        return invalidInput
    }
    guard SecureEnclave.isAvailable else {
        return secureStorageUnavailable
    }
    switch loadWrappedRepresentation(account: account) {
    case .failure(let error):
        return error.code
    case .success(let representation):
        do {
            let key = try SecureEnclave.P256.Signing.PrivateKey(dataRepresentation: representation)
            return copyBytes(key.publicKey.rawRepresentation, into: publicKey, count: 64)
                ? success
                : operationFailure
        } catch {
            return secureStorageUnavailable
        }
    }
}

@_cdecl("codetether_secure_enclave_sign")
public func codetetherSecureEnclaveSign(
    _ account: UnsafePointer<CChar>?,
    _ payload: UnsafePointer<UInt8>?,
    _ payloadCount: Int,
    _ signature: UnsafeMutablePointer<UInt8>?
) -> Int32 {
    guard let account = accountString(account), !account.isEmpty,
          let payload, payloadCount > 0 else {
        return invalidInput
    }
    guard SecureEnclave.isAvailable else {
        return secureStorageUnavailable
    }
    switch loadWrappedRepresentation(account: account) {
    case .failure(let error):
        return error.code
    case .success(let representation):
        do {
            let key = try SecureEnclave.P256.Signing.PrivateKey(dataRepresentation: representation)
            let signatureValue = try key.signature(for: Data(bytes: payload, count: payloadCount))
            return copyBytes(signatureValue.rawRepresentation, into: signature, count: 64)
                ? success
                : operationFailure
        } catch {
            return operationFailure
        }
    }
}

@_cdecl("codetether_secure_enclave_destroy")
public func codetetherSecureEnclaveDestroy(
    _ account: UnsafePointer<CChar>?
) -> Int32 {
    guard let account = accountString(account), !account.isEmpty else {
        return invalidInput
    }
    return deleteWrappedRepresentation(account: account)
}
