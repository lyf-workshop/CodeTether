import XCTest
import SwiftUI
@testable import CodeTether

final class AccountLifetimeTests: XCTestCase {
    @MainActor
    func testLateWriteResponseAfterSignOutCannotRestoreOldAccountState() async throws {
        let suite = "CodeTether.AccountLifetimeTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }

        let computer = Fixtures.computer
        let account = LifetimeAccount(computer: computer)
        let wire = SuspendedWriteWire()
        let model = TabletAppModel(
            defaults: defaults,
            account: account,
            sessionProvider: { _, _ in wire },
            initialState: Fixtures.conversationState(computer: computer)
        )

        await model.start()
        await account.setDirectoryAvailable(true)
        model.actions.updateDraft("conversation_lifetime", "待发送草稿")
        model.actions.send("conversation_lifetime", "迟到的成功响应")
        let actionID = await wire.waitForAction()
        XCTAssertNotNil(actionID)
        XCTAssertEqual(model.state.pendingActions.count, 1)

        model.actions.signOut()
        await account.waitUntilSignedOut()
        XCTAssertFalse(model.state.isAuthenticated)
        XCTAssertTrue(model.state.pendingActions.isEmpty)
        XCTAssertTrue(model.state.conversationDrafts.isEmpty)

        await wire.completeWrite()
        try? await Task.sleep(nanoseconds: 80_000_000)

        XCTAssertFalse(model.state.isAuthenticated)
        XCTAssertNil(model.state.activeConversation)
        XCTAssertTrue(model.state.pendingActions.isEmpty)
        XCTAssertTrue(model.state.conversationDrafts.isEmpty)
        XCTAssertNil(defaults.data(forKey: "tablet.pendingActions"))
        XCTAssertNil(defaults.data(forKey: "tablet.conversationDrafts"))
        let actionIDs = await wire.actionIDsSnapshot()
        XCTAssertEqual(actionIDs, [actionID].compactMap { $0 })
    }
}

private enum Fixtures {
    static let profile = AccountProfile(id: "account_lifetime", email: "lifetime@example.test")

    static let computer = PairedComputer(
        id: "computer_lifetime", name: "测试电脑", platform: "macOS", canControl: true,
        isAvailable: true, expiresAt: "2099-01-01T00:00:00Z", authorizationID: "authorization_lifetime",
        hostFingerprint: "fingerprint_lifetime", identityGeneration: 1, hostPublicJWKJSON: "{}",
        grantJSON: nil, descriptorJSON: nil, lastUsedAt: nil
    )

    static func conversationState(computer: PairedComputer) -> TabletViewState {
        let project = TabletProject(
            id: "project_lifetime", computerID: computer.id, machineID: "machine_lifetime",
            name: "项目", available: true, sessions: []
        )
        let machine = TabletMachine(
            id: "machine_lifetime", name: "设备", platform: "macOS", status: "online", isLocal: false,
            projects: [project], recent: [], providers: []
        )
        let tabletComputer = TabletComputer(
            id: computer.id, name: computer.name, platform: computer.platform, lastUsed: "刚刚",
            available: true, canControl: true, authorizationExpiresAt: computer.expiresAt, machines: [machine]
        )
        let summary = TabletConversationSummary(
            id: "conversation_lifetime", computerID: computer.id, machineID: "machine_lifetime",
            projectID: project.id, machineName: "设备", projectName: project.name, title: "测试会话",
            providerName: "Codex", status: "idle", lastActivity: "刚刚", isArchived: false, isImported: false
        )
        var state = TabletViewState()
        state.isAuthenticated = true
        state.email = profile.email
        state.computers = [tabletComputer]
        state.route = .conversation(computerID: computer.id, conversationID: summary.id)
        state.activeConversation = TabletConversationDetail(
            summary: summary, messages: [], attentions: [], canSend: true, canArchive: false,
            canInterrupt: false, canViewChanges: false, isRunning: false, currentTurnID: nil,
            lastFailure: nil, olderCursor: nil
        )
        return state
    }
}

private actor LifetimeAccount: TabletAccountService {
    private let computer: PairedComputer
    private var directoryAvailable = false
    private var signedOut = false

    init(computer: PairedComputer) {
        self.computer = computer
    }

    func restore() async throws -> AccountProfile? { Fixtures.profile }
    func requestSignInCode(email: String) async throws { }
    func verifySignInCode(email: String, code: String) async throws -> AccountProfile { Fixtures.profile }
    func signOut() async { signedOut = true }

    func directory() async throws -> [PairedComputer] {
        guard directoryAvailable else { throw ClientFailure.computerUnavailable }
        return [computer]
    }

    func connectContext(computerID: String, mode: TabletConnectionMode) async throws -> SupervisorConnectContext {
        throw ClientFailure.computerUnavailable
    }

    func pair(code: String, onClaimed: @Sendable () -> Void) async throws -> PairedComputer {
        throw ClientFailure.computerUnavailable
    }

    func remove(computerID: String) async throws { }
    func setDirectoryAvailable(_ available: Bool) { directoryAvailable = available }

    func waitUntilSignedOut() async {
        while !signedOut { await Task.yield() }
    }
}

private actor SuspendedWriteWire: SupervisorWireSession {
    let transport = "relay"
    let control = true
    let expiresAt = "2099-01-01T00:00:00Z"

    private var continuation: CheckedContinuation<String, Never>?
    private var receivedActionID: String?
    private var recordedActionIDs: [String] = []

    func actionIDsSnapshot() -> [String] { recordedActionIDs }

    func request(_ json: String) async throws -> String {
        guard let object = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any],
              object["operation"] as? String == "conversation.turn.start",
              let actionID = object["actionId"] as? String else {
            throw ClientFailure.invalidResponse
        }
        receivedActionID = actionID
        recordedActionIDs.append(actionID)
        return await withCheckedContinuation { continuation in
            self.continuation = continuation
        }
    }

    func close() async { }

    func waitForAction() async -> String? {
        while receivedActionID == nil { await Task.yield() }
        return receivedActionID
    }

    func completeWrite() {
        guard let actionID = receivedActionID, let continuation else { return }
        self.continuation = nil
        let response: [String: Any] = ["actionId": actionID, "status": "accepted"]
        let data = try! JSONSerialization.data(withJSONObject: response, options: [.sortedKeys])
        continuation.resume(returning: String(decoding: data, as: UTF8.self))
    }
}
