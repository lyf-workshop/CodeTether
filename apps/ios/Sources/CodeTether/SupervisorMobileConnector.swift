import Foundation

struct IpadMobileCryptoAdapter: IpadMobileCrypto {
    func signCompactProof(payloadJSON: String, identity: DeviceIdentity) async throws -> String {
        let signer = DeviceIdentitySigner(identity: identity)
        do {
            return try await Task.detached(priority: .userInitiated) {
                try CodeTether.signCompactProof(
                    proofType: "codetether-device-registration+jws",
                    payloadJson: payloadJSON,
                    signer: signer
                )
            }.value
        } catch {
            throw ClientFailure.deviceIdentityUnavailable
        }
    }

    func requestProof(
        accessToken: String,
        deviceID: String,
        keyGeneration: UInt64,
        method: String,
        resource: String,
        body: Data,
        identity: DeviceIdentity
    ) async throws -> String {
        let signer = DeviceIdentitySigner(identity: identity)
        do {
            return try await Task.detached(priority: .userInitiated) {
                try CodeTether.deviceRequestProof(
                    accessToken: accessToken,
                    deviceId: deviceID,
                    keyGeneration: keyGeneration,
                    method: method,
                    resource: resource,
                    body: body,
                    signer: signer
                )
            }.value
        } catch {
            throw ClientFailure.deviceIdentityUnavailable
        }
    }
}

private final class DeviceIdentitySigner: DeviceSigner, @unchecked Sendable {
    private let identity: DeviceIdentity

    init(identity: DeviceIdentity) {
        self.identity = identity
    }

    func signDer(message: Data) throws -> Data {
        do {
            return try identity.signDER(message)
        } catch {
            throw MobileError.Failure(code: "device_signing_failed", httpStatus: nil)
        }
    }
}

struct SupervisorMobileConnector: SupervisorConnector {
    func connect(_ context: SupervisorConnectContext, mode: TabletConnectionMode) async throws -> any SupervisorWireSession {
        guard let grant = context.computer.grantJSON,
              let descriptor = context.computer.descriptorJSON else {
            throw ClientFailure.computerUnavailable
        }
        let options = ConnectOptions(
            hostId: context.computer.id,
            hostFingerprint: context.computer.hostFingerprint,
            hostIdentityGeneration: context.computer.identityGeneration,
            hostPublicJwkJson: context.computer.hostPublicJWKJSON,
            deviceId: context.device.id,
            deviceKeyGeneration: context.device.generation,
            grantJson: grant,
            descriptorJson: descriptor,
            accessToken: context.session.accessToken,
            mode: Self.map(mode)
        )
        let signer = DeviceIdentitySigner(identity: context.device.identity)
        do {
            let session = try await Task.detached(priority: .userInitiated) {
                try connectSupervisor(options: options, signer: signer)
            }.value
            return SupervisorMobileWireSession(native: session)
        } catch let error as MobileError {
            throw Self.wireFailure(error)
        } catch {
            throw SupervisorWireFailure(code: "connection_failed", status: nil)
        }
    }

    private static func map(_ mode: TabletConnectionMode) -> ConnectionMode {
        switch mode {
        case .automatic: .auto
        case .direct: .direct
        case .relay: .relay
        }
    }

    private static func wireFailure(_ error: MobileError) -> SupervisorWireFailure {
        switch error {
        case .Failure(let code, let status):
            SupervisorWireFailure(code: code, status: status.map(Int.init))
        }
    }
}

private final class SupervisorMobileWireSession: SupervisorWireSession, @unchecked Sendable {
    private let native: SupervisorSession
    private let requests = DispatchQueue(label: "org.codetether.supervisor.requests")

    let transport: String
    let control: Bool
    let expiresAt: String

    init(native: SupervisorSession) {
        self.native = native
        transport = native.transport()
        control = native.control() == "control"
        expiresAt = native.expiresAt()
    }

    func request(_ json: String) async throws -> String {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<String, Error>) in
            requests.async { [native] in
                do {
                    continuation.resume(returning: try native.request(operationJson: json))
                } catch let error as MobileError {
                    continuation.resume(throwing: Self.wireFailure(error))
                } catch {
                    continuation.resume(throwing: SupervisorWireFailure(code: "connection_failed", status: nil))
                }
            }
        }
    }

    func close() async {
        let native = self.native
        await Task.detached(priority: .userInitiated) { native.disconnect() }.value
    }

    private static func wireFailure(_ error: MobileError) -> SupervisorWireFailure {
        switch error {
        case .Failure(let code, let status):
            SupervisorWireFailure(code: code, status: status.map(Int.init))
        }
    }
}
