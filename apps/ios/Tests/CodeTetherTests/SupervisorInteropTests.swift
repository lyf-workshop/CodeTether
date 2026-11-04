import CryptoKit
import XCTest
@testable import CodeTether

final class SupervisorInteropTests: XCTestCase {
    func testSimulatorReadsAndWritesThroughDirectAndRelay() async throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "InteropFixture", withExtension: "json"))
        let bytes = try Data(contentsOf: url)
        let values = try XCTUnwrap(JSONSerialization.jsonObject(with: bytes) as? [String: Any])
        let options = try options(from: values, mode: .direct)
        let signer = FixtureSigner()

        for mode in [ConnectionMode.direct, .relay] {
            var selected = options
            selected.mode = mode
            let session = try await Task.detached(priority: .userInitiated) {
                try connectSupervisor(options: selected, signer: signer)
            }.value

            let read = try await Task.detached(priority: .userInitiated) {
                try session.request(operationJson: "{\"operation\":\"machine.list\"}")
            }.value
            let readResult = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(read.utf8)) as? [String: Any])
            XCTAssertEqual(readResult["fixtureOperation"] as? String, "machine.list")

            let actionID = mode == .direct ? "act_ios_fixture_direct" : "act_ios_fixture_relay"
            let write = try await Task.detached(priority: .userInitiated) {
                let request: [String: Any] = [
                    "operation": "attention.resolve",
                    "attentionId": "attn_fixture_item",
                    "actionId": actionID,
                ]
                let json = try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
                return try session.request(operationJson: String(decoding: json, as: UTF8.self))
            }.value
            let writeResult = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(write.utf8)) as? [String: Any])
            XCTAssertEqual(writeResult["fixtureOperation"] as? String, "attention.resolve")
            XCTAssertEqual(writeResult["actionId"] as? String, actionID)

            await Task.detached(priority: .userInitiated) { session.disconnect() }.value
        }
    }

    private func options(from values: [String: Any], mode: ConnectionMode) throws -> ConnectOptions {
        func requiredString(_ key: String) throws -> String {
            try XCTUnwrap(values[key] as? String)
        }
        func encoded(_ key: String) throws -> String {
            let value = try XCTUnwrap(values[key])
            let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
            return String(decoding: data, as: UTF8.self)
        }
        return ConnectOptions(
            hostId: try requiredString("hostId"),
            hostFingerprint: try requiredString("hostFingerprint"),
            hostIdentityGeneration: 1,
            hostPublicJwkJson: try encoded("publicJwk"),
            deviceId: try requiredString("deviceId"),
            deviceKeyGeneration: 1,
            grantJson: try encoded("grant"),
            descriptorJson: try encoded("descriptor"),
            accessToken: try requiredString("accessToken"),
            mode: mode
        )
    }
}

private final class FixtureSigner: DeviceSigner, @unchecked Sendable {
    private let key: P256.Signing.PrivateKey

    init() {
        key = try! P256.Signing.PrivateKey(rawRepresentation: Data(repeating: 7, count: 32))
    }

    func signDer(message: Data) throws -> Data {
        try key.signature(for: message).derRepresentation
    }
}
