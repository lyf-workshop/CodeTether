import SwiftUI
import XCTest
@testable import CodeTether

final class AccountRecoveryTests: XCTestCase {
    @MainActor
    func testTemporaryRestoreFailureCanRecoverWhenAppBecomesActive() async throws {
        let (defaults, suite) = try makeDefaults()
        defer { defaults.removePersistentDomain(forName: suite) }
        let account = RecoveryAccount(failFirstRestore: true)
        let model = TabletAppModel(defaults: defaults, account: account)

        await model.start()
        XCTAssertFalse(model.state.isAuthenticated)
        XCTAssertNotNil(model.state.errorMessage)

        model.sceneChanged(.active)
        try await waitFor { model.state.isAuthenticated }
        XCTAssertEqual(model.state.email, "recovery@example.test")
        let restoreCount = await account.restoreCount()
        XCTAssertEqual(restoreCount, 2)
    }

    @MainActor
    func testExpiredSessionReturnsToLoginAndKeepsDraftForSameAccount() async throws {
        let (defaults, suite) = try makeDefaults()
        defer { defaults.removePersistentDomain(forName: suite) }
        let account = RecoveryAccount()
        let model = TabletAppModel(defaults: defaults, account: account)
        let pending = TabletPendingAction(
            accountID: "account_recovery", actionID: "act_recovery", operation: .sendTurn,
            computerID: "computer_recovery", machineID: "machine_recovery", projectID: "project_recovery",
            conversationID: "conversation_recovery", provider: nil, reasoning: nil, input: "待确认内容"
        )
        let stored = RecoveryStoredActions(accountID: "account_recovery", actions: [pending])
        defaults.set(try JSONEncoder().encode(stored), forKey: "tablet.pendingActions")

        await model.start()
        XCTAssertTrue(model.state.isAuthenticated)
        XCTAssertEqual(model.state.pendingActions[pending.scope], pending)
        model.actions.updateDraft("conversation_recovery", "待发送内容")
        await account.setDirectoryExpired(true)
        model.actions.refresh()
        try await waitFor { !model.state.isAuthenticated }
        XCTAssertEqual(model.state.errorMessage, ClientFailure.signInRequired.localizedDescription)
        XCTAssertTrue(model.state.conversationDrafts.isEmpty)
        XCTAssertTrue(model.state.pendingActions.isEmpty)
        XCTAssertNotNil(defaults.data(forKey: "tablet.conversationDrafts"))
        XCTAssertNotNil(defaults.data(forKey: "tablet.pendingActions"))

        await account.setDirectoryExpired(false)
        model.actions.verifySignInCode("recovery@example.test", "123456")
        try await waitFor { model.state.isAuthenticated }
        XCTAssertEqual(model.state.conversationDrafts["conversation_recovery"], "待发送内容")
        XCTAssertEqual(model.state.pendingActions[pending.scope], pending)
    }

    @MainActor
    func testSignOutStorageFailureIsShownInsteadOfSilentlySucceeded() async throws {
        let (defaults, suite) = try makeDefaults()
        defer { defaults.removePersistentDomain(forName: suite) }
        let account = RecoveryAccount(signOutFailure: true)
        let model = TabletAppModel(defaults: defaults, account: account)
        await model.start()
        XCTAssertTrue(model.state.isAuthenticated)

        model.actions.signOut()
        try await waitFor { model.state.errorMessage == ClientFailure.sessionStorageFailed.localizedDescription }
        XCTAssertFalse(model.state.isAuthenticated)
    }

    private func makeDefaults() throws -> (UserDefaults, String) {
        let suite = "CodeTether.AccountRecoveryTests.\(UUID().uuidString)"
        return (try XCTUnwrap(UserDefaults(suiteName: suite)), suite)
    }

    @MainActor
    private func waitFor(_ condition: () -> Bool) async throws {
        for _ in 0..<100 {
            if condition() { return }
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        XCTFail("Timed out waiting for account state")
    }
}

private struct RecoveryStoredActions: Codable {
    let accountID: String
    let actions: [TabletPendingAction]
}

private actor RecoveryAccount: TabletAccountService {
    private let profile = AccountProfile(id: "account_recovery", email: "recovery@example.test")
    private var failFirstRestore: Bool
    private let signOutFailure: Bool
    private var restores = 0
    private var directoryExpired = false

    init(failFirstRestore: Bool = false, signOutFailure: Bool = false) {
        self.failFirstRestore = failFirstRestore
        self.signOutFailure = signOutFailure
    }

    func restore() async throws -> AccountProfile? {
        restores += 1
        if failFirstRestore {
            failFirstRestore = false
            throw ClientFailure.requestFailed
        }
        return profile
    }

    func restoreCount() -> Int { restores }
    func setDirectoryExpired(_ expired: Bool) { directoryExpired = expired }
    func requestSignInCode(email: String) async throws { }
    func verifySignInCode(email: String, code: String) async throws -> AccountProfile { profile }
    func signOut() async throws {
        if signOutFailure { throw ClientFailure.sessionStorageFailed }
    }
    func directory() async throws -> [PairedComputer] {
        if directoryExpired { throw ClientFailure.signInRequired }
        return []
    }
    func connectContext(computerID: String, mode: TabletConnectionMode) async throws -> SupervisorConnectContext {
        throw ClientFailure.computerUnavailable
    }
    func pair(code: String, onClaimed: @Sendable () -> Void) async throws -> PairedComputer {
        throw ClientFailure.computerUnavailable
    }
    func remove(computerID: String) async throws { }
}
