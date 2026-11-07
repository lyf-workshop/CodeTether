import XCTest
import SwiftUI
import Combine
@testable import CodeTether

final class AppModelRegressionTests: XCTestCase {
    @MainActor
    func testPairingStateIsIndependentOfBackgroundRefreshAndCancels() async throws {
        let suite = "CodeTether.AppModelRegressionTests.pairingBusy.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let account = TestAccount(profile: TestFixtures.profile, computers: [])
        await account.setDirectoryDelay(500_000_000)
        await account.setHoldPair(true)
        let model = TabletAppModel(
            defaults: defaults, account: account,
            initialState: {
                var state = TabletViewState()
                state.isAuthenticated = true
                return state
            }()
        )
        defer { model.sceneChanged(.background) }

        let startup = Task { await model.start() }
        await waitForState(model, description: "background refresh in flight") { $0.isBusy }
        XCTAssertFalse(model.state.isPairing)

        model.actions.pair("123456")
        await waitForState(model, description: "pairing in flight") { $0.isPairing && $0.isBusy }
        model.actions.cancelPair()
        await waitForState(model, description: "pairing cancellation") { !$0.isPairing }
        XCTAssertEqual(model.state.pairingMessage, "已取消等待。")
        await startup.value
    }

    @MainActor
    func testConversationDraftRestoresFromLocalDefaults() async throws {
        let suite = "CodeTether.AppModelRegressionTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }

        let firstLaunch = TabletAppModel(defaults: defaults, account: TestAccount(profile: TestFixtures.profile, computers: []), initialState: {
            var state = TabletViewState()
            state.isAuthenticated = true
            return state
        }())
        await firstLaunch.start()
        firstLaunch.actions.updateDraft("conversation_test", "unfinished request")

        let relaunched = TabletAppModel(defaults: defaults, account: TestAccount(profile: TestFixtures.profile, computers: []), initialState: {
            var state = TabletViewState()
            state.isAuthenticated = true
            return state
        }())
        await relaunched.start()
        XCTAssertEqual(relaunched.state.conversationDrafts["conversation_test"], "unfinished request")
    }

    @MainActor
    func testSceneInactiveAndActiveKeepsRealSendInFlight() async throws {
        let suite = "CodeTether.AppModelRegressionTests.scene.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let account = TestAccount(profile: TestFixtures.profile, computers: [TestFixtures.computer])
        let wire = ScriptedWire(outcomes: [.hold])
        let model = TabletAppModel(
            defaults: defaults, account: account,
            sessionProvider: { _, _ in wire }, initialState: TestFixtures.conversationState
        )
        defer { model.sceneChanged(.background) }
        await model.start()
        await account.setDirectoryAvailable(true)
        model.actions.send("conversation_test", "继续")
        await waitForMutationCount(wire, 1)
        model.sceneChanged(.inactive)
        model.sceneChanged(.active)
        await waitForWorkspaceRead(wire, 1)
        let duringTransition = await wire.recordedMutations()
        XCTAssertEqual(duringTransition.count, 1)
        XCTAssertEqual(model.state.pendingActions.count, 1)

        await wire.completeMutation(at: 0)
        await waitForState(model, description: "send completed") { $0.pendingActions.isEmpty }
        XCTAssertTrue(model.state.pendingActions.isEmpty)
    }

    @MainActor
    func testSceneInactiveAndActiveKeepsRealCreateInFlight() async throws {
        let suite = "CodeTether.AppModelRegressionTests.createScene.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let account = TestAccount(profile: TestFixtures.profile, computers: [TestFixtures.computer])
        let wire = ScriptedWire(outcomes: [.hold])
        let model = TabletAppModel(
            defaults: defaults, account: account,
            sessionProvider: { _, _ in wire }, initialState: TestFixtures.viewState(computer: TestFixtures.computer)
        )
        defer { model.sceneChanged(.background) }
        await model.start()
        await account.setDirectoryAvailable(true)
        model.actions.createConversation("project_test", "codex", nil, "新建过程中切换场景")
        await waitForMutationCount(wire, 1)

        model.sceneChanged(.inactive)
        model.sceneChanged(.active)
        await waitForWorkspaceRead(wire, 1)
        let duringTransition = await wire.recordedMutations()
        XCTAssertEqual(duringTransition.map(\.operation), ["conversation.create"])
        XCTAssertEqual(model.state.pendingActions.count, 1)

        await wire.completeMutation(at: 0)
        await waitForState(model, description: "create completed") {
            $0.pendingActions.isEmpty && $0.route == .conversation(computerID: "computer_test", conversationID: "conversation_created")
        }
        let completed = await wire.recordedMutations()
        XCTAssertEqual(completed.count, 1)
    }

    @MainActor
    func testSignOutClearsDraftPendingAndSupervisorState() async throws {
        let suite = "CodeTether.AppModelRegressionTests.signout.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let account = TestAccount(profile: TestFixtures.profile, computers: [TestFixtures.computer])
        let wire = ScriptedWire(outcomes: [.failure("connection_closed")])
        let model = TabletAppModel(
            defaults: defaults, account: account,
            sessionProvider: { _, _ in wire }, initialState: TestFixtures.viewState(computer: TestFixtures.computer)
        )
        await model.start()
        await account.setDirectoryAvailable(true)
        model.actions.createConversation("project_test", "codex", nil, "未确认")
        await waitForMutationCount(wire, 1)
        await waitForState(model, description: "pending create before sign-out") {
            !$0.pendingActions.isEmpty && $0.createSessionErrorMessage != nil && !$0.isBusy
        }
        model.actions.updateDraft("conversation_test", "草稿")
        XCTAssertFalse(model.state.pendingActions.isEmpty)
        model.actions.signOut()
        await waitForState(model, description: "sign-out cleared account state") { !$0.isAuthenticated }
        XCTAssertTrue(model.state.pendingActions.isEmpty)
        XCTAssertTrue(model.state.conversationDrafts.isEmpty)
        XCTAssertTrue(model.state.computers.isEmpty)
        XCTAssertNil(defaults.data(forKey: "tablet.pendingActions"))
        XCTAssertNil(defaults.data(forKey: "tablet.conversationDrafts"))

        model.actions.navigate(.conversation(computerID: "computer_test", conversationID: "conversation_test"))
        await TestFixtures.waitForTasks()
        let operationsAfterSignOut = await wire.recordedOperations()
        XCTAssertFalse(operationsAfterSignOut.contains("conversation.history"))

        let anotherAccount = TestAccount(
            profile: AccountProfile(id: "account_other", email: "other@example.com"), computers: []
        )
        let switched = TabletAppModel(defaults: defaults, account: anotherAccount)
        await switched.start()
        XCTAssertTrue(switched.state.pendingActions.isEmpty)
        XCTAssertTrue(switched.state.conversationDrafts.isEmpty)
    }

    @MainActor
    func testPendingCreateSurvivesRestartAndClearsAfterOriginalActionSucceeds() async throws {
        let suite = "CodeTether.AppModelRegressionTests.pending.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }

        let computer = TestFixtures.computer
        let initial = TestFixtures.viewState(computer: computer)
        let account = TestAccount(profile: TestFixtures.profile, computers: [computer])
        let wire = TestWire(mode: .accept)
        let model = TabletAppModel(
            defaults: defaults, account: account,
            sessionProvider: { _, _ in wire }, initialState: initial
        )
        await model.start()
        await account.setDirectoryAvailable(false)
        model.actions.createConversation("project_test", "codex", nil, "开始工作")
        await TestFixtures.waitForTasks()
        XCTAssertEqual(model.state.pendingActions.count, 1)

        let relaunched = TabletAppModel(
            defaults: defaults, account: account,
            sessionProvider: { _, _ in wire }, initialState: initial
        )
        await relaunched.start()
        XCTAssertEqual(relaunched.state.pendingActions.values.first?.input, "开始工作")

        await account.setDirectoryAvailable(true)
        guard let pending = relaunched.state.pendingActions.values.first else {
            return XCTFail("pending action was not restored")
        }
        relaunched.actions.retryUncertainAction(pending.actionID)
        await TestFixtures.waitForTasks()
        XCTAssertTrue(relaunched.state.pendingActions.isEmpty)
        if case .conversation(_, let conversationID) = relaunched.state.route {
            XCTAssertEqual(conversationID, "conversation_created")
        } else {
            XCTFail("successful retry did not navigate to the new conversation")
        }
    }

    @MainActor
    func testRetryConnectFailureKeepsPendingThenReplaysOriginalRequest() async throws {
        let suite = "CodeTether.AppModelRegressionTests.retryConnect.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let account = TestAccount(profile: TestFixtures.profile, computers: [TestFixtures.computer])
        let wire = ScriptedWire(outcomes: [.failure("connection_closed"), .accept])
        let sessions = TestSessionFactory(wire: wire, failedAttempts: [2])
        let model = TabletAppModel(
            defaults: defaults, account: account,
            sessionProvider: { computer, mode in try await sessions.connect(computer, mode: mode) },
            initialState: TestFixtures.conversationState
        )
        defer { model.sceneChanged(.background) }
        await model.start()
        await account.setDirectoryAvailable(true)
        let input = "保留原始请求内容"
        model.actions.updateDraft("conversation_test", input)
        model.actions.send("conversation_test", input)
        await waitForState(model, description: "first send became uncertain") {
            !$0.pendingActions.isEmpty && $0.errorMessage != nil && !$0.isBusy
        }
        guard let pending = model.state.pendingActions.values.first else {
            return XCTFail("uncertain send was not retained")
        }

        model.actions.retryUncertainAction(pending.actionID)
        await waitForSessionAttempts(sessions, 2)
        await waitForState(model, description: "retry connection failure settled") {
            $0.pendingActions[pending.scope] != nil && !$0.isBusy
        }
        let failedRetryAttempts = await sessions.attemptCount()
        XCTAssertEqual(failedRetryAttempts, 2)
        XCTAssertNotNil(model.state.pendingActions[pending.scope])

        model.actions.retryUncertainAction(pending.actionID)
        await waitForState(model, description: "retry succeeded") { $0.pendingActions.isEmpty }
        let mutations = await wire.recordedMutations()
        XCTAssertEqual(mutations.map(\.actionID), [pending.actionID, pending.actionID])
        XCTAssertEqual(mutations.map(\.input), [input, input])
        XCTAssertTrue(model.state.pendingActions.isEmpty)
        XCTAssertNil(defaults.data(forKey: "tablet.pendingActions"))
    }

    @MainActor
    func testInFlightSendRestoresPendingAcrossModelRestartAndReusesActionID() async throws {
        let suite = "CodeTether.AppModelRegressionTests.restartSend.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let account = TestAccount(profile: TestFixtures.profile, computers: [TestFixtures.computer])
        let firstWire = ScriptedWire(outcomes: [.hold])
        let first = TabletAppModel(
            defaults: defaults, account: account,
            sessionProvider: { _, _ in firstWire }, initialState: TestFixtures.conversationState
        )
        defer { first.sceneChanged(.background) }
        await account.setDirectoryAvailable(true)
        await first.start()
        let input = "系统回收前已经提交"
        first.actions.updateDraft("conversation_test", input)
        first.actions.send("conversation_test", input)
        await waitForMutationCount(firstWire, 1)
        guard let pending = first.state.pendingActions.values.first else {
            return XCTFail("action was not persisted before entering the wire")
        }

        await account.setDirectoryAvailable(false)
        let retryWire = ScriptedWire(outcomes: [.accept])
        let relaunched = TabletAppModel(
            defaults: defaults, account: account,
            sessionProvider: { _, _ in retryWire }, initialState: TestFixtures.conversationState
        )
        defer { relaunched.sceneChanged(.background) }
        await relaunched.start()
        XCTAssertEqual(relaunched.state.pendingActions[pending.scope]?.actionID, pending.actionID)

        await account.setDirectoryAvailable(true)
        relaunched.actions.retryUncertainAction(pending.actionID)
        await waitForState(relaunched, description: "recovered send succeeded") { $0.pendingActions.isEmpty }
        let replayed = await retryWire.recordedMutations()
        XCTAssertEqual(replayed.map(\.actionID), [pending.actionID])
        XCTAssertEqual(replayed.map(\.input), [input])

        await firstWire.failMutation(at: 0, code: "connection_closed")
        await waitForState(first, description: "original uncertain operation returned") { $0.errorMessage != nil }
        XCTAssertNil(defaults.data(forKey: "tablet.pendingActions"))
    }

    func testExplicitWriteRejectionIsNotUncertain() async throws {
        let account = TestAccount(profile: TestFixtures.profile, computers: [TestFixtures.computer])
        await account.setDirectoryAvailable(true)
        let wire = TestWire(mode: .reject)
        let client = SupervisorClient(
            account: account, connector: TestConnector(),
            sessionProvider: { _, _ in wire }
        )
        let action = TestFixtures.pendingCreate
        do {
            _ = try await client.perform(action, mode: .relay)
            XCTFail("expected rejection")
        } catch {
            XCTAssertNil((error as? SupervisorClientError)?.uncertainActionID)
            XCTAssertTrue(SupervisorClient.isExplicitWriteRejection(error))
        }
    }

    @MainActor
    func testExplicitWriteRejectionClearsPendingAndKeepsDraft() async throws {
        let suite = "CodeTether.AppModelRegressionTests.rejection.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let account = TestAccount(profile: TestFixtures.profile, computers: [TestFixtures.computer])
        await account.setDirectoryAvailable(true)
        let wire = ScriptedWire(outcomes: [.failure("invalid_request"), .accept])
        let model = TabletAppModel(
            defaults: defaults, account: account,
            sessionProvider: { _, _ in wire }, initialState: TestFixtures.conversationState
        )
        await model.start()
        model.actions.updateDraft("conversation_test", "请求被拒绝")
        model.actions.send("conversation_test", "请求被拒绝")
        await waitForState(model, description: "explicit rejection is shown") {
            $0.pendingActions.isEmpty && $0.errorMessage != nil
        }
        XCTAssertTrue(model.state.pendingActions.isEmpty)
        XCTAssertEqual(model.state.conversationDrafts["conversation_test"], "请求被拒绝")
        XCTAssertNotNil(model.state.errorMessage)

        model.actions.send("conversation_test", "请求被拒绝")
        await waitForMutationCount(wire, 2)
        await waitForState(model, description: "edited request settles") { $0.pendingActions.isEmpty }
        XCTAssertNil(model.state.errorMessage, model.state.errorMessage ?? "unexpected error")
        let mutations = await wire.recordedMutations()
        XCTAssertEqual(mutations.map(\.input), ["请求被拒绝", "请求被拒绝"])
        XCTAssertNotEqual(mutations[0].actionID, mutations[1].actionID)
        XCTAssertNil(model.state.conversationDrafts["conversation_test"])
    }

    @MainActor
    func testRetryConflictClearsPendingAndShowsReason() async throws {
        let suite = "CodeTether.AppModelRegressionTests.conflict.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let account = TestAccount(profile: TestFixtures.profile, computers: [TestFixtures.computer])
        await account.setDirectoryAvailable(true)
        let wire = TestWire(mode: .failThenConflict)
        let model = TabletAppModel(
            defaults: defaults, account: account,
            sessionProvider: { _, _ in wire }, initialState: TestFixtures.conversationState
        )
        await model.start()
        model.actions.send("conversation_test", "重试冲突")
        await TestFixtures.waitForTasks()
        XCTAssertEqual(model.state.pendingActions.count, 1)
        guard let pending = model.state.pendingActions.values.first else { return XCTFail("pending action missing") }
        model.actions.retryUncertainAction(pending.actionID)
        await TestFixtures.waitForTasks()
        XCTAssertTrue(model.state.pendingActions.isEmpty)
        XCTAssertNotNil(model.state.errorMessage)
    }

    func testRetryReusesActionIDAfterConnectionFailure() async throws {
        let account = TestAccount(profile: TestFixtures.profile, computers: [TestFixtures.computer])
        await account.setDirectoryAvailable(true)
        let wire = TestWire(mode: .failOnce)
        let client = SupervisorClient(
            account: account, connector: TestConnector(),
            sessionProvider: { _, _ in wire }
        )
        let action = TestFixtures.pendingSend
        do {
            _ = try await client.perform(action, mode: .relay)
            XCTFail("expected uncertain failure")
        } catch {
            XCTAssertEqual((error as? SupervisorClientError)?.uncertainActionID, action.actionID)
        }
        _ = try await client.perform(action, mode: .relay)
        XCTAssertEqual(wire.actionIDs, [action.actionID, action.actionID])
    }

    private enum TestFixtures {
        static let profile = AccountProfile(id: "account_test", email: "test@example.com")
        static let computer = PairedComputer(
            id: "computer_test", name: "测试电脑", platform: "macOS", canControl: true,
            isAvailable: true, expiresAt: "2099-01-01T00:00:00Z", authorizationID: "authorization_test",
            hostFingerprint: "fingerprint_test", identityGeneration: 1, hostPublicJWKJSON: "{}",
            grantJSON: nil, descriptorJSON: nil, lastUsedAt: nil
        )
        static let pendingCreate = TabletPendingAction(
            accountID: profile.id, actionID: "act_create_test", operation: .createConversation,
            computerID: computer.id, machineID: "machine_test", projectID: "project_test",
            conversationID: nil, provider: "codex", reasoning: nil, input: "开始工作"
        )
        static let pendingSend = TabletPendingAction(
            accountID: profile.id, actionID: "act_send_test", operation: .sendTurn,
            computerID: computer.id, machineID: "machine_test", projectID: "project_test",
            conversationID: "conversation_test", provider: nil, reasoning: nil, input: "继续"
        )

        static func viewState(computer: PairedComputer) -> TabletViewState {
            let provider = TabletProvider(
                id: "codex", name: "Codex", status: "available", canStart: true,
                canApprove: false, canInterrupt: false, canViewChanges: false, reasoningOptions: [], unavailableReason: nil
            )
            let project = TabletProject(
                id: "project_test", computerID: computer.id, machineID: "machine_test", name: "项目",
                available: true, sessions: []
            )
            let machine = TabletMachine(
                id: "machine_test", name: "设备", platform: "macOS", status: "online", isLocal: false,
                projects: [project], recent: [], providers: [provider]
            )
            var state = TabletViewState()
            state.isAuthenticated = true
            state.email = profile.email
            state.computers = [TabletComputer(
                id: computer.id, name: computer.name, platform: computer.platform, lastUsed: "刚刚",
                available: true, canControl: true, authorizationExpiresAt: computer.expiresAt, machines: [machine]
            )]
            return state
        }

        static var conversationState: TabletViewState {
            var state = viewState(computer: computer)
            let summary = TabletConversationSummary(
                id: "conversation_test", computerID: computer.id, machineID: "machine_test", projectID: "project_test",
                machineName: "设备", projectName: "项目", title: "测试会话", providerName: "Codex",
                status: "idle", lastActivity: "刚刚", isArchived: false, isImported: false
            )
            state.route = .conversation(computerID: computer.id, conversationID: summary.id)
            state.activeConversation = TabletConversationDetail(
                summary: summary, messages: [], attentions: [], canSend: true, canArchive: false,
                canInterrupt: false, canViewChanges: false, isRunning: false, currentTurnID: nil,
                lastFailure: nil, olderCursor: nil
            )
            return state
        }

        static func waitForTasks() async {
            try? await Task.sleep(nanoseconds: 250_000_000)
        }
    }

    @MainActor
    private func waitForState(
        _ model: TabletAppModel,
        description: String,
        timeout: TimeInterval = 3,
        matching predicate: (TabletViewState) -> Bool
    ) async {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if predicate(model.state) { return }
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTFail("Timed out waiting for \(description)")
    }

    private func waitForMutationCount(_ wire: ScriptedWire, _ count: Int) async {
        let deadline = Date().addingTimeInterval(3)
        while Date() < deadline {
            if await wire.recordedMutations().count >= count { return }
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTFail("Timed out waiting for the mutation")
    }

    private func waitForWorkspaceRead(_ wire: ScriptedWire, _ count: Int) async {
        let deadline = Date().addingTimeInterval(3)
        while Date() < deadline {
            if await wire.workspaceReadCount() >= count { return }
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTFail("Timed out waiting for workspace refresh")
    }

    private func waitForSessionAttempts(_ sessions: TestSessionFactory, _ count: Int) async {
        let deadline = Date().addingTimeInterval(3)
        while Date() < deadline {
            if await sessions.attemptCount() >= count { return }
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTFail("Timed out waiting for the connection attempt")
    }

    private actor TestAccount: TabletAccountService {
        let profile: AccountProfile
        let computers: [PairedComputer]
        var directoryAvailable: Bool
        private var directoryDelay: UInt64 = 0
        private var holdPair = false

        init(profile: AccountProfile, computers: [PairedComputer]) {
            self.profile = profile
            self.computers = computers
            directoryAvailable = false
        }

        func restore() async throws -> AccountProfile? { profile }
        func requestSignInCode(email: String) async throws { }
        func verifySignInCode(email: String, code: String) async throws -> AccountProfile { profile }
        func signOut() async { }
        func directory() async throws -> [PairedComputer] {
            if directoryDelay > 0 { try await Task.sleep(nanoseconds: directoryDelay) }
            guard directoryAvailable else { throw ClientFailure.computerUnavailable }
            return computers
        }
        func connectContext(computerID: String, mode: TabletConnectionMode) async throws -> SupervisorConnectContext {
            throw ClientFailure.computerUnavailable
        }
        func pair(code: String, onClaimed: @Sendable () -> Void) async throws -> PairedComputer {
            if holdPair { try await Task.sleep(nanoseconds: 30_000_000_000) }
            throw ClientFailure.computerUnavailable
        }
        func remove(computerID: String) async throws { }
        func setDirectoryAvailable(_ available: Bool) { directoryAvailable = available }
        func setDirectoryDelay(_ delay: UInt64) { directoryDelay = delay }
        func setHoldPair(_ hold: Bool) { holdPair = hold }
    }

    private actor TestSessionFactory {
        let wire: any SupervisorWireSession
        var failedAttempts: Set<Int>
        private var attempts = 0

        init(wire: any SupervisorWireSession, failedAttempts: Set<Int>) {
            self.wire = wire
            self.failedAttempts = failedAttempts
        }

        func connect(_ computer: PairedComputer, mode: TabletConnectionMode) throws -> any SupervisorWireSession {
            attempts += 1
            if failedAttempts.remove(attempts) != nil { throw ClientFailure.computerUnavailable }
            return wire
        }

        func attemptCount() -> Int { attempts }
    }

    private actor ScriptedWire: SupervisorWireSession {
        struct Mutation: Equatable, Sendable {
            let operation: String
            let actionID: String
            let input: String
        }

        enum Outcome: Sendable {
            case accept
            case failure(String)
            case hold
        }

        nonisolated let transport = "relay"
        nonisolated let control = true
        nonisolated let expiresAt = "2099-01-01T00:00:00Z"
        private var outcomes: [Outcome]
        private var mutations: [Mutation] = []
        private var continuations: [Int: CheckedContinuation<String, Error>] = [:]
        private var closeCount = 0
        private var workspaceReads = 0
        private var operations: [String] = []
        private let includeWorkspace: Bool

        init(outcomes: [Outcome], includeWorkspace: Bool = false) {
            self.outcomes = outcomes
            self.includeWorkspace = includeWorkspace
        }

        func request(_ json: String) async throws -> String {
            let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any])
            let operation = try XCTUnwrap(object["operation"] as? String)
            operations.append(operation)
            if operation == "machine.get" {
                let providers: [[String: Any]] = [[
                    "provider": "codex", "availability": "available",
                    "capabilities": ["providerExecution": true], "executionHealth": ["state": "healthy"]
                ]]
                return Self.response([
                    "machineId": "machine_test",
                    "machine": ["machineId": "machine_test", "displayName": "设备", "platform": "macOS", "architecture": "arm64"],
                    "providers": providers,
                ])
            }
            if operation == "host.bootstrap" {
                workspaceReads += 1
                return Self.response([:])
            }
            if operation == "machine.list" {
                guard includeWorkspace else { return Self.response(["machines": []]) }
                return Self.response(["machines": [[
                    "machineId": "machine_test", "availability": "available", "connectionState": "online",
                    "isLocal": false, "capabilities": ["projectAccess": true, "providerExecution": true]
                ]]])
            }
            if operation == "project.list" {
                return includeWorkspace
                    ? Self.response(["projects": [["machineId": "machine_test", "projectId": "project_test", "name": "项目"]], "hasMore": false])
                    : Self.response(["projects": [], "hasMore": false])
            }
            if operation == "conversation.recent" {
                return includeWorkspace
                    ? Self.response(["conversations": [[
                        "machineId": "machine_test", "projectId": "project_test", "conversationId": "conversation_test",
                        "title": "测试会话", "provider": "codex", "status": "idle", "archived": false
                    ]]])
                    : Self.response(["conversations": []])
            }
            if operation == "conversation.get" {
                return Self.response(["conversation": [
                    "conversationId": "conversation_test", "machineId": "machine_test", "projectId": "project_test",
                    "provider": "codex", "title": "测试会话", "status": "idle", "archived": false,
                    "lastActivityAt": "2026-01-01T00:00:00Z"
                ]])
            }
            if operation == "conversation.history" {
                return Self.response([
                    "conversationId": "conversation_test", "hasMoreBefore": false, "historyComplete": true,
                    "liveCursor": "test-live", "source": "durable",
                    "runtime": ["conversationId": "conversation_test", "turns": [], "messages": [], "tools": []]
                ])
            }
            if operation == "attention.list" { return Self.response(["items": []]) }
            guard let actionID = object["actionId"] as? String else { return Self.response([:]) }
            let input = (object["input"] as? [String: Any])?["text"] as? String ?? ""
            let index = mutations.count
            mutations.append(Mutation(operation: operation, actionID: actionID, input: input))
            let outcome = index < outcomes.count ? outcomes[index] : .accept
            switch outcome {
            case .accept: return Self.accepted(operation: operation, actionID: actionID)
            case .failure(let code): throw SupervisorWireFailure(code: code, status: nil)
            case .hold:
                return try await withCheckedThrowingContinuation { continuation in
                    continuations[index] = continuation
                }
            }
        }

        func recordedMutations() -> [Mutation] { mutations }
        func recordedCloseCount() -> Int { closeCount }
        func workspaceReadCount() -> Int { workspaceReads }
        func recordedOperations() -> [String] { operations }

        func completeMutation(at index: Int) {
            guard let continuation = continuations.removeValue(forKey: index),
                  mutations.indices.contains(index) else { return }
            let mutation = mutations[index]
            continuation.resume(returning: Self.accepted(operation: mutation.operation, actionID: mutation.actionID))
        }

        func failMutation(at index: Int, code: String) {
            guard let continuation = continuations.removeValue(forKey: index) else { return }
            continuation.resume(throwing: SupervisorWireFailure(code: code, status: nil))
        }

        func close() async { closeCount += 1 }

        private static func accepted(operation: String, actionID: String) -> String {
            if operation == "conversation.create" {
                return response(["actionId": actionID, "status": "accepted", "data": [
                    "conversation": ["conversationId": "conversation_created", "machineId": "machine_test", "projectId": "project_test"]
                ]])
            }
            return response(["actionId": actionID, "status": "accepted"])
        }

        private static func response(_ value: [String: Any]) -> String {
            String(decoding: try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]), as: UTF8.self)
        }
    }

    private struct TestConnector: SupervisorConnector {
        func connect(_ context: SupervisorConnectContext, mode: TabletConnectionMode) async throws -> any SupervisorWireSession {
            throw ClientFailure.computerUnavailable
        }
    }

    private final class TestWire: SupervisorWireSession, @unchecked Sendable {
        enum Mode { case accept, reject, failOnce, failThenConflict }
        let mode: Mode
        let transport = "relay"
        let control = true
        let expiresAt = "2099-01-01T00:00:00Z"
        private(set) var actionIDs: [String] = []
        let delayNanoseconds: UInt64
        private var failed = false

        init(mode: Mode, delayNanoseconds: UInt64 = 0) {
            self.mode = mode
            self.delayNanoseconds = delayNanoseconds
        }

        func request(_ json: String) async throws -> String {
            let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any])
            let operation = try XCTUnwrap(object["operation"] as? String)
            if delayNanoseconds > 0 { try await Task.sleep(nanoseconds: delayNanoseconds) }
            if operation == "machine.get" {
                return Self.response(["machineId": "machine_test", "providers": [[
                    "provider": "codex", "availability": "available",
                    "capabilities": ["providerExecution": true], "executionHealth": ["state": "healthy"]
                ]]])
            }
            guard let actionID = object["actionId"] as? String else {
                return Self.response(["fixtureOperation": operation, "machines": [], "items": []])
            }
            actionIDs.append(actionID)
            if mode == .failOnce && !failed {
                failed = true
                throw SupervisorWireFailure(code: "connection_closed", status: nil)
            }
            if mode == .failThenConflict {
                if !failed {
                    failed = true
                    throw SupervisorWireFailure(code: "connection_closed", status: nil)
                }
                throw SupervisorWireFailure(code: "conflict", status: 409)
            }
            if mode == .reject { throw SupervisorWireFailure(code: "invalid_request", status: 400) }
            if operation == "conversation.create" {
                return Self.response(["actionId": actionID, "status": "accepted", "data": [
                    "conversation": ["conversationId": "conversation_created", "machineId": "machine_test", "projectId": "project_test"]
                ]])
            }
            return Self.response(["actionId": actionID, "status": "accepted"])
        }

        func close() async { }

        private static func response(_ value: [String: Any]) -> String {
            String(decoding: try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]), as: UTF8.self)
        }
    }

    private actor SubmissionCounter {
        private var counts: [String: Int] = [:]
        private var started = Set<String>()

        func recordSubmission(_ operation: String) {
            counts[operation, default: 0] += 1
        }

        func markStarted(_ operation: String) {
            started.insert(operation)
        }

        func waitUntilStarted(_ operations: Set<String>) async {
            while !operations.isSubset(of: started) {
                await Task.yield()
            }
        }

        func submissionCounts() -> [String: Int] { counts }
    }
}
