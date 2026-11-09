import Foundation
import XCTest
@testable import CodeTether

final class AccountClientSessionTests: XCTestCase {
    func testPairingExpiryAcceptsServerTimestampsAndRejectsExpiredOrInvalidValues() throws {
        let now = try XCTUnwrap(TabletTimestamp.parse("2026-11-07T04:00:00Z"))
        let fractional = try AccountClient.pairingExpiry("2026-11-07T04:05:00.000Z", now: now)
        let ordinary = try AccountClient.pairingExpiry("2026-11-07T04:05:00Z", now: now)
        XCTAssertEqual(fractional, ordinary)

        for value in ["2026-11-07T04:00:00.000Z", "2026-11-07T03:59:59Z"] {
            XCTAssertThrowsError(try AccountClient.pairingExpiry(value, now: now)) { error in
                guard case ClientFailure.pairingExpired = error else {
                    return XCTFail("Unexpected error: \(error)")
                }
            }
        }
        XCTAssertThrowsError(try AccountClient.pairingExpiry("not-a-date", now: now)) { error in
            guard case ClientFailure.invalidResponse = error else { return XCTFail("Unexpected error: \(error)") }
        }
    }

    func testVerificationServerFailureDoesNotReportWrongCode() {
        guard case .requestFailed = AccountClient.verificationFailure(status: 503) else {
            return XCTFail("A server error must not be presented as an invalid code")
        }
        guard case .verifyCodeFailed = AccountClient.verificationFailure(status: 400) else {
            return XCTFail("An invalid-code response must remain distinguishable")
        }
        guard case .requestRateLimited = AccountClient.verificationFailure(status: 429) else {
            return XCTFail("Rate limiting must remain distinguishable")
        }
        guard case .requestFailed = AccountClient.verificationFailure(status: 401) else {
            return XCTFail("Authentication service failures must not be presented as an invalid code")
        }
    }

    func testControlPlaneNon401FailuresArePresentedSafely() async throws {
        for status in [429, 503] {
            StubAccountURLProtocol.setStatuses([status])
            let store = MemoryAccountStore(session: freshSession)
            let client = try makeHTTPClient(store: store)
            let session = try await client.currentSession()
            do {
                _ = try await client.ensureRegistered(session)
                XCTFail("Expected an HTTP failure for status \(status)")
            } catch let failure as ClientFailure {
                switch (status, failure) {
                case (429, .requestRateLimited), (503, .requestFailed): break
                default: XCTFail("Unexpected error for status \(status): \(failure)")
                }
            }
            XCTAssertEqual(StubAccountURLProtocol.requestCount(), 1)
            XCTAssertEqual(store.loadCount(), freshSession)
        }
    }

    func testControlPlane401StillRefreshesOnceAndPreservesSessionForDeviceFailure() async throws {
        StubAccountURLProtocol.setStatuses([401, 401])
        let store = MemoryAccountStore(session: freshSession)
        let client = try makeHTTPClient(store: store)
        let session = try await client.currentSession()
        do {
            _ = try await client.ensureRegistered(session)
            XCTFail("Expected failure after the second unauthorized response")
        } catch let failure as ClientFailure {
            guard case .requestFailed = failure else { return XCTFail("Unexpected error: \(failure)") }
        }
        XCTAssertEqual(StubAccountURLProtocol.requestCount(), 2)
        XCTAssertEqual(store.saveCount(), 1)
        XCTAssertEqual(store.loadCount(), freshSession)
    }

    func testConcurrentExpiredSessionRefreshRunsOnce() async throws {
        let store = MemoryAccountStore(session: expiredSession)
        let probe = RefreshProbe()
        let client = try makeClient(store: store, probe: probe)
        let tasks = (0..<8).map { _ in Task { try await client.currentSession() } }
        await probe.waitForStart()
        try await Task.sleep(nanoseconds: 100_000_000)
        await probe.complete(with: freshSession)
        for task in tasks {
            let session = try await task.value
            XCTAssertEqual(session, freshSession)
        }
        let refreshCount = await probe.count
        XCTAssertEqual(refreshCount, 1)
        XCTAssertEqual(store.loadCount(), freshSession)
        XCTAssertEqual(store.saveCount(), 1)
    }

    func testLateRefreshCannotRestoreSessionAfterSignOut() async throws {
        let store = MemoryAccountStore(session: expiredSession)
        let probe = RefreshProbe()
        let client = try makeClient(store: store, probe: probe)
        let refresh = Task { try await client.currentSession() }
        await probe.waitForStart()
        try? await client.signOut()
        await probe.complete(with: freshSession)
        do {
            _ = try await refresh.value
            XCTFail("A refresh started before sign-out must not succeed")
        } catch {
            XCTAssertNil(store.loadCount())
            XCTAssertEqual(store.saveCount(), 0)
        }
    }

    func testConcurrentFirstDeviceRegistrationSharesOneAttempt() async throws {
        let store = MemoryAccountStore(session: freshSession)
        let registration = RegistrationProbe()
        let client = try makeClient(store: store, registration: registration)
        let session = try await client.currentSession()

        let first = Task { try await client.ensureRegistered(session) }
        await registration.waitForStart()
        let second = Task { try await client.ensureRegistered(session) }
        try await Task.sleep(nanoseconds: 100_000_000)
        let countBeforeFailure = await registration.count
        XCTAssertEqual(countBeforeFailure, 1)
        await registration.fail()
        for task in [first, second] {
            do {
                _ = try await task.value
                XCTFail("The registration probe must fail after both callers share it")
            } catch { }
        }
        let countAfterFailure = await registration.count
        XCTAssertEqual(countAfterFailure, 1)
    }

    func testSignOutSurfacesSessionStorageFailure() async throws {
        let store = MemoryAccountStore(session: freshSession, failClear: true)
        let client = try makeClient(store: store, probe: RefreshProbe())
        _ = try await client.currentSession()
        do {
            try await client.signOut()
            XCTFail("A failed local credential clear must not be reported as successful sign-out")
        } catch let failure as ClientFailure {
            guard case .sessionStorageFailed = failure else { return XCTFail("Unexpected error: \(failure)") }
        }
        XCTAssertEqual(store.loadCount(), freshSession)
    }

    private var expiredSession: AccountSession {
        AccountSession(profile: AccountProfile(id: "test-account", email: "test@example.invalid"),
                       accessToken: "old-access", refreshToken: "old-refresh", expiresAt: 1)
    }

    private var freshSession: AccountSession {
        AccountSession(profile: AccountProfile(id: "test-account", email: "test@example.invalid"),
                       accessToken: "new-access", refreshToken: "new-refresh", expiresAt: 4_000_000_000)
    }

    private func makeClient(store: MemoryAccountStore, probe: RefreshProbe) throws -> AccountClient {
        try makeClient(store: store, probe: probe, registration: nil)
    }

    private func makeClient(
        store: MemoryAccountStore,
        probe: RefreshProbe = RefreshProbe(),
        registration: RegistrationProbe?,
        httpConfiguration: URLSessionConfiguration? = nil,
        refreshOverride: (@Sendable (AccountSession) async throws -> AccountSession)? = nil
    ) throws -> AccountClient {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("AccountClientTests-\(UUID().uuidString).bundle")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let plist: [String: Any] = [
            "CFBundleIdentifier": "org.codetether.test.configuration",
            "CodeTetherControlPlaneURL": "https://control.example.invalid",
            "CodeTetherSupabaseURL": "https://auth.example.invalid",
            "CodeTetherSupabasePublishableKey": "test-public-key",
        ]
        let data = try PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0)
        try data.write(to: directory.appendingPathComponent("Info.plist"))
        let bundle = try XCTUnwrap(Bundle(path: directory.path))
        let configuration = try IpadConfiguration(bundle: bundle)
        return AccountClient(configuration: configuration, crypto: UnusedCrypto(), sessionStore: store,
                             refreshOverride: refreshOverride ?? { session in try await probe.refresh(session) },
                             logoutOverride: { _ in },
                             registrationOverride: registration.map { value in { _ in try await value.begin() } },
                             httpConfiguration: httpConfiguration)
    }

    private func makeHTTPClient(store: MemoryAccountStore) throws -> AccountClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubAccountURLProtocol.self]
        return try makeClient(store: store, registration: nil, httpConfiguration: configuration,
                              refreshOverride: { $0 })
    }
}

private final class StubAccountURLProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    private static var statuses: [Int] = []
    private static var requests = 0

    static func setStatuses(_ values: [Int]) {
        lock.lock(); defer { lock.unlock() }
        statuses = values
        requests = 0
    }

    static func requestCount() -> Int {
        lock.lock(); defer { lock.unlock() }
        return requests
    }

    private static func nextStatus() -> Int {
        lock.lock(); defer { lock.unlock() }
        requests += 1
        return statuses.isEmpty ? 500 : statuses.removeFirst()
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let response = HTTPURLResponse(url: request.url!, statusCode: Self.nextStatus(),
                                       httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data("{}".utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() { }
}

private final class MemoryAccountStore: AccountSessionStorage, @unchecked Sendable {
    private let lock = NSLock()
    private var session: AccountSession?
    private var saves = 0
    private let failClear: Bool

    init(session: AccountSession?, failClear: Bool = false) { self.session = session; self.failClear = failClear }
    func load() throws -> AccountSession? { loadCount() }
    func loadCount() -> AccountSession? { lock.lock(); defer { lock.unlock() }; return session }
    func saveCount() -> Int { lock.lock(); defer { lock.unlock() }; return saves }
    func save(_ session: AccountSession) throws {
        lock.lock(); defer { lock.unlock() }
        self.session = session
        saves += 1
    }
    func clear() throws {
        lock.lock(); defer { lock.unlock() }
        if failClear { throw ClientFailure.requestFailed }
        session = nil
    }
}

private actor RegistrationProbe {
    private(set) var count = 0
    private var continuation: CheckedContinuation<RegisteredDevice, Error>?
    private var started: [CheckedContinuation<Void, Never>] = []

    func begin() async throws -> RegisteredDevice {
        count += 1
        for waiter in started { waiter.resume() }
        started.removeAll()
        return try await withCheckedThrowingContinuation { continuation = $0 }
    }

    func waitForStart() async {
        if count > 0 { return }
        await withCheckedContinuation { started.append($0) }
    }

    func fail() {
        continuation?.resume(throwing: ClientFailure.requestFailed)
        continuation = nil
    }
}

private actor RefreshProbe {
    private(set) var count = 0
    private var waiting: [CheckedContinuation<Void, Never>] = []
    private var continuations: [CheckedContinuation<AccountSession, Error>] = []

    func refresh(_ session: AccountSession) async throws -> AccountSession {
        count += 1
        for waiter in waiting { waiter.resume() }
        waiting.removeAll()
        return try await withCheckedThrowingContinuation { continuations.append($0) }
    }

    func waitForStart() async {
        if count > 0 { return }
        await withCheckedContinuation { waiting.append($0) }
    }

    func complete(with session: AccountSession) {
        for continuation in continuations { continuation.resume(returning: session) }
        continuations.removeAll()
    }
}

private struct UnusedCrypto: IpadMobileCrypto {
    func signCompactProof(payloadJSON: String, identity: DeviceIdentity) async throws -> String {
        throw ClientFailure.unsupported
    }
    func requestProof(accessToken: String, deviceID: String, keyGeneration: UInt64, method: String,
                      resource: String, body: Data, identity: DeviceIdentity) async throws -> String {
        throw ClientFailure.unsupported
    }
}
