import Combine
import SwiftUI

enum TabletActionScope: Hashable {
    case create(projectID: String)
    case send(conversationID: String)
}

enum TabletPendingOperation: String, Codable {
    case createConversation
    case sendTurn
}

struct TabletPendingAction: Codable, Equatable, Identifiable {
    let accountID: String
    let actionID: String
    let operation: TabletPendingOperation
    let computerID: String
    let machineID: String
    let projectID: String
    let conversationID: String?
    let provider: String?
    let reasoning: String?
    let input: String

    var id: String { actionID }
    var scope: TabletActionScope {
        switch operation {
        case .createConversation: .create(projectID: projectID)
        case .sendTurn: .send(conversationID: conversationID ?? "")
        }
    }
}

private struct StoredTabletActions: Codable {
    let accountID: String
    let actions: [TabletPendingAction]
}

private struct StoredTabletDrafts: Codable {
    let accountID: String
    let drafts: [String: String]
}

enum TabletLifecyclePolicy {
    static func suspendsForegroundWork(for phase: ScenePhase) -> Bool {
        phase == .background
    }
}

@MainActor
final class TabletAppModel: ObservableObject {
    @Published private(set) var state: TabletViewState

    private var account: (any TabletAccountService)?
    private var supervisor: SupervisorClient?
    private var pollTask: Task<Void, Never>?
    private var pairingTask: Task<Void, Never>?
    private var operationTasks: [UUID: Task<Void, Never>] = [:]
    private var busyCount = 0
    private var lastWorkspaceRefresh = Date.distantPast
    private var bootstrapped = false
    private let defaults: UserDefaults
    private let injectedAccount: (any TabletAccountService)?
    private let injectedSessionProvider: SupervisorClient.SessionProvider?
    private var currentAccountID: String?
    private var accountGeneration = UUID()
    private var inFlightActionIDs = Set<String>()
    private var signOutTask: Task<Void, Never>?
    private let isNewSessionFailureUITest: Bool
    private let isPendingCreateUITest: Bool

    static func makeForLaunch() -> TabletAppModel {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--ui-test-pending-create-retry") {
            return TabletAppModel(
                account: UITestPendingCreateAccount(),
                sessionProvider: { _, _ in UITestPendingCreateWire() }
            )
        }
        #endif
        return TabletAppModel()
    }

    init(
        defaults: UserDefaults = .standard,
        account: (any TabletAccountService)? = nil,
        sessionProvider: SupervisorClient.SessionProvider? = nil,
        initialState: TabletViewState = TabletViewState()
    ) {
        self.defaults = defaults
        injectedAccount = account
        injectedSessionProvider = sessionProvider
        #if DEBUG
        isNewSessionFailureUITest = ProcessInfo.processInfo.arguments.contains("--ui-test-new-session-failure")
        isPendingCreateUITest = ProcessInfo.processInfo.arguments.contains("--ui-test-pending-create-retry")
        #else
        isNewSessionFailureUITest = false
        isPendingCreateUITest = false
        #endif
        var initial = initialState
        initial.appearance = TabletAppearance(rawValue: defaults.string(forKey: "tablet.appearance") ?? "") ?? .system
        initial.connectionMode = TabletConnectionMode(rawValue: defaults.string(forKey: "tablet.connectionMode") ?? "") ?? .automatic
        initial.expandedSidebarIDs = Set(defaults.stringArray(forKey: "tablet.expandedSidebarIDs") ?? [])
        #if DEBUG
        if isNewSessionFailureUITest {
            initial.isAuthenticated = true
            initial.computers = Self.newSessionFailureFixture()
        }
        if isPendingCreateUITest {
            initial.isAuthenticated = true
            initial.computers = UITestPendingCreateFixture.computers
        }
        #endif
        state = initial
    }

    var actions: TabletViewActions {
        var result = TabletViewActions()
        result.requestSignInCode = { [weak self] email in self?.requestSignInCode(email) }
        result.verifySignInCode = { [weak self] email, code in self?.verifySignInCode(email, code) }
        result.signOut = { [weak self] in self?.signOut() }
        result.pair = { [weak self] code in self?.pair(code) }
        result.cancelPair = { [weak self] in self?.cancelPair() }
        result.removeComputer = { [weak self] id in self?.removeComputer(id) }
        result.navigate = { [weak self] route in self?.navigate(route) }
        result.toggleExpanded = { [weak self] id in self?.toggleExpanded(id) }
        result.setAppearance = { [weak self] appearance in self?.setAppearance(appearance) }
        result.setConnectionMode = { [weak self] mode in self?.setConnectionMode(mode) }
        result.refresh = { [weak self] in self?.refresh() }
        result.createConversation = { [weak self] projectID, provider, reasoning, input in
            self?.createConversation(projectID: projectID, provider: provider, reasoning: reasoning, input: input)
        }
        result.send = { [weak self] conversationID, text in self?.send(conversationID: conversationID, text: text) }
        result.updateDraft = { [weak self] conversationID, text in self?.updateDraft(conversationID: conversationID, text: text) }
        result.retryUncertainAction = { [weak self] actionID in self?.retryUncertainAction(actionID) }
        result.approve = { [weak self] attentionID, accepted in self?.approve(attentionID: attentionID, accepted: accepted) }
        result.resolveAttention = { [weak self] attentionID in self?.resolveAttention(attentionID: attentionID) }
        result.interrupt = { [weak self] conversationID, turnID in self?.interrupt(conversationID: conversationID, turnID: turnID) }
        result.archive = { [weak self] conversationID in self?.archive(conversationID: conversationID) }
        result.loadChanges = { [weak self] conversationID in self?.loadChanges(conversationID: conversationID) }
        result.loadOlder = { [weak self] conversationID, cursor in self?.loadOlder(conversationID: conversationID, cursor: cursor) }
        result.search = { [weak self] query in self?.search(query) }
        result.dismissError = { [weak self] in self?.update { $0.errorMessage = nil } }
        return result
    }

    func start() async {
        guard !isNewSessionFailureUITest else { return }
        guard !bootstrapped else { return }
        bootstrapped = true
        let generation = accountGeneration
        do {
            try configureClients()
            if let profile = try await account?.restore() {
                guard generation == accountGeneration else { return }
                update {
                    $0.isAuthenticated = true
                    $0.email = profile.email
                }
                setAccount(profile.id)
                if isPendingCreateUITest {
                    setPendingAction(UITestPendingCreateFixture.pendingAction)
                    return
                }
                await refreshSnapshot()
            }
        } catch {
            guard generation == accountGeneration else { return }
            show(error)
        }
    }

    func taskDidStart() {
        guard !isPendingCreateUITest else { return }
        startPolling()
    }

    func sceneChanged(_ phase: ScenePhase) {
        if phase == .active {
            let generation = accountGeneration
            launch { [weak self] in
                guard let self else { return }
                await self.start()
                guard generation == self.accountGeneration else { return }
                if self.state.isAuthenticated { await self.refreshSnapshot() }
                guard generation == self.accountGeneration else { return }
                self.startPolling()
            }
        } else if TabletLifecyclePolicy.suspendsForegroundWork(for: phase) {
            pollTask?.cancel()
            pollTask = nil
            pairingTask?.cancel()
            for task in operationTasks.values { task.cancel() }
            operationTasks.removeAll()
            let oldSupervisor = supervisor
            launch { await oldSupervisor?.disconnectAll() }
        }
    }

    private func configureClients() throws {
        guard account == nil else { return }
        let account: any TabletAccountService
        if let injectedAccount {
            account = injectedAccount
        } else {
            let configuration = try IpadConfiguration()
            account = AccountClient(configuration: configuration, crypto: IpadMobileCryptoAdapter())
        }
        self.account = account
        supervisor = SupervisorClient(
            account: account, connector: SupervisorMobileConnector(), sessionProvider: injectedSessionProvider
        )
    }

    private func requestSignInCode(_ email: String) {
        let generation = accountGeneration
        launch { [weak self] in
            guard let self else { return }
            await self.performBusy {
                do {
                    await self.signOutTask?.value
                    guard generation == self.accountGeneration else { return }
                    try self.configureClients()
                    try await self.account?.requestSignInCode(email: email)
                    guard generation == self.accountGeneration else { return }
                    self.update {
                        $0.email = email.trimmingCharacters(in: .whitespacesAndNewlines)
                        $0.codeRequested = true
                        $0.errorMessage = nil
                    }
                } catch {
                    guard generation == self.accountGeneration else { return }
                    self.show(error)
                }
            }
        }
    }

    private func verifySignInCode(_ email: String, _ code: String) {
        let generation = accountGeneration
        launch { [weak self] in
            guard let self else { return }
            await self.performBusy {
                do {
                    await self.signOutTask?.value
                    guard generation == self.accountGeneration else { return }
                    try self.configureClients()
                    let profile = try await self.account?.verifySignInCode(email: email, code: code)
                    guard generation == self.accountGeneration else { return }
                    guard let profile else { throw ClientFailure.invalidResponse }
                    self.update {
                        $0.isAuthenticated = true
                        $0.email = profile.email
                        $0.codeRequested = false
                        $0.errorMessage = nil
                    }
                    self.setAccount(profile.id)
                    await self.refreshSnapshot()
                } catch {
                    guard generation == self.accountGeneration else { return }
                    self.show(error)
                }
            }
        }
    }

    private func signOut() {
        guard signOutTask == nil else { return }
        accountGeneration = UUID()
        let generation = accountGeneration
        pollTask?.cancel()
        pollTask = nil
        pairingTask?.cancel()
        pairingTask = nil
        for task in operationTasks.values { task.cancel() }
        operationTasks.removeAll()
        inFlightActionIDs.removeAll()
        busyCount = 0
        let oldAccount = account
        let oldSupervisor = supervisor
        account = nil
        supervisor = nil
        clearAccountData()
        update {
            $0.isAuthenticated = false
            $0.email = ""
            $0.codeRequested = false
            $0.computers = []
            $0.attentions = []
            $0.activeConversation = nil
            $0.conversationDrafts = [:]
            $0.pendingActions = [:]
            $0.changes = []
            $0.changesLoading = false
            $0.searchResults = []
            $0.pairingMessage = nil
            $0.isPairing = false
            $0.createSessionErrorMessage = nil
            $0.route = .home
            $0.errorMessage = nil
            $0.isBusy = false
        }
        // Invalidate local work before awaiting network or wire cleanup. Native
        // requests may finish after Task.cancel(), so their account epoch is fenced.
        signOutTask = Task { @MainActor [weak self] in
            await oldSupervisor?.clearLocalState()
            await oldAccount?.signOut()
            guard let self, generation == self.accountGeneration else { return }
            self.signOutTask = nil
        }
    }

    private func pair(_ code: String) {
        guard pairingTask == nil else { return }
        let generation = accountGeneration
        update { $0.isPairing = true }
        pairingTask = Task { @MainActor [weak self] in
            guard let self else { return }
            await self.performBusy {
                do {
                    guard let account = self.account else { throw ClientFailure.signInRequired }
                    self.update { $0.pairingMessage = nil }
                    _ = try await account.pair(code: code) { [weak self] in
                        Task { @MainActor in
                            guard let self, generation == self.accountGeneration else { return }
                            self.update { $0.pairingMessage = "已提交配对请求，正在等待电脑确认。" }
                        }
                    }
                    guard generation == self.accountGeneration else { return }
                    self.update { $0.pairingMessage = nil; $0.isRemoved = false }
                    await self.refreshSnapshot()
                } catch is CancellationError {
                    guard generation == self.accountGeneration else { return }
                    self.update { $0.pairingMessage = "已取消等待。" }
                } catch {
                    guard generation == self.accountGeneration else { return }
                    self.update { $0.pairingMessage = error.localizedDescription }
                }
            }
            guard generation == self.accountGeneration else { return }
            self.pairingTask = nil
            self.update { $0.isPairing = false }
        }
    }

    private func cancelPair() {
        pairingTask?.cancel()
    }

    private func removeComputer(_ id: String) {
        let generation = accountGeneration
        launch { [weak self] in
            guard let self else { return }
            await self.performBusy {
                do {
                    try await self.account?.remove(computerID: id)
                    guard generation == self.accountGeneration else { return }
                    self.update {
                        $0.computers.removeAll { $0.id == id }
                        if case .device(let computerID, _) = $0.route, computerID == id { $0.route = .devices }
                        if case .project(let computerID, _) = $0.route, computerID == id { $0.route = .devices }
                        if case .conversation(let computerID, _) = $0.route, computerID == id {
                            $0.route = .devices
                            $0.activeConversation = nil
                        }
                    }
                } catch {
                    guard generation == self.accountGeneration else { return }
                    self.show(error)
                }
            }
        }
    }

    private func navigate(_ route: TabletRoute) {
        update { $0.route = route; $0.errorMessage = nil }
        guard case .conversation(let computerID, let conversationID) = route else {
            update { $0.activeConversation = nil }
            return
        }
        loadConversation(computerID: computerID, conversationID: conversationID)
    }

    private func toggleExpanded(_ id: String) {
        var ids = state.expandedSidebarIDs
        if !ids.insert(id).inserted { ids.remove(id) }
        update { $0.expandedSidebarIDs = ids }
        defaults.set(Array(ids), forKey: "tablet.expandedSidebarIDs")
    }

    private func setAppearance(_ appearance: TabletAppearance) {
        update { $0.appearance = appearance }
        defaults.set(appearance.rawValue, forKey: "tablet.appearance")
    }

    private func setConnectionMode(_ mode: TabletConnectionMode) {
        update { $0.connectionMode = mode }
        defaults.set(mode.rawValue, forKey: "tablet.connectionMode")
        refresh()
    }

    private func refresh() {
        launch { [weak self] in await self?.refreshSnapshot() }
    }

    private func refreshSnapshot() async {
        guard state.isAuthenticated, let supervisor else { return }
        let generation = accountGeneration
        await performBusy {
            do {
                let snapshot = try await supervisor.refresh(mode: self.state.connectionMode)
                guard generation == self.accountGeneration else { return }
                self.apply(snapshot)
            } catch {
                guard generation == self.accountGeneration else { return }
                self.show(error)
            }
        }
    }

    private func apply(_ snapshot: SupervisorSnapshot) {
        update {
            $0.computers = snapshot.computers
            $0.attentions = snapshot.attentions
            $0.connectionTransport = snapshot.selectedTransport
            $0.connectionStatus = snapshot.connectedComputerCount > 0
                ? "已连接 \(snapshot.connectedComputerCount) 台电脑"
                : "暂时没有可连接的电脑"
            $0.connectionDiagnostic = snapshot.selectedTransport.isEmpty
                ? "请检查电脑是否在线，以及当前连接方式。"
                : "当前使用 \(snapshot.selectedTransport == "relay" ? "Relay" : "直连")。"
        }
        lastWorkspaceRefresh = Date()
    }

    private func loadConversation(computerID: String, conversationID: String) {
        let generation = accountGeneration
        launch { [weak self] in
            guard let self else { return }
            do {
                let detail = try await self.supervisor?.conversation(
                    computerID: computerID, conversationID: conversationID, mode: self.state.connectionMode
                )
                guard generation == self.accountGeneration else { return }
                if let detail { self.update { $0.activeConversation = detail } }
            } catch {
                guard generation == self.accountGeneration else { return }
                self.show(error)
            }
        }
    }

    private func createConversation(projectID: String, provider: String, reasoning: String?, input: String) {
        let scope = TabletActionScope.create(projectID: projectID)
        guard state.pendingActions[scope] == nil else { return }
        update { $0.createSessionErrorMessage = nil }
        if isNewSessionFailureUITest {
            update { $0.createSessionErrorMessage = "模拟创建失败，请检查连接后重试。" }
            return
        }
        guard let accountID = currentAccountID,
              let choice = state.computers
                .flatMap({ computer in computer.machines.flatMap { machine in machine.projects.map { (computer, machine, $0) } } })
                .first(where: { $0.2.id == projectID }) else {
            update { $0.createSessionErrorMessage = ClientFailure.invalidResponse.localizedDescription }
            return
        }
        let action = TabletPendingAction(
            accountID: accountID, actionID: Self.newActionID(), operation: .createConversation,
            computerID: choice.0.id, machineID: choice.1.id, projectID: projectID,
            conversationID: nil, provider: provider, reasoning: reasoning, input: input
        )
        guard inFlightActionIDs.insert(action.actionID).inserted else { return }
        setPendingAction(action)
        launch { [weak self] in
            guard let self else { return }
            await self.performBusy {
                await self.executePendingAction(action, retry: false)
            }
        }
    }

    private func send(conversationID: String, text: String) {
        guard let detail = state.activeConversation, detail.summary.id == conversationID else { return }
        let scope = TabletActionScope.send(conversationID: conversationID)
        guard state.pendingActions[scope] == nil else { return }
        update { $0.errorMessage = nil }
        let computerID = detail.summary.computerID
        guard let accountID = currentAccountID else { return }
        let action = TabletPendingAction(
            accountID: accountID, actionID: Self.newActionID(), operation: .sendTurn,
            computerID: computerID, machineID: detail.summary.machineID,
            projectID: detail.summary.projectID, conversationID: conversationID,
            provider: nil, reasoning: nil, input: text
        )
        guard inFlightActionIDs.insert(action.actionID).inserted else { return }
        setPendingAction(action)
        launch { [weak self] in
            guard let self else { return }
            await self.executePendingAction(action, retry: false)
        }
    }

    private func updateDraft(conversationID: String, text: String) {
        update {
            $0.conversationDrafts[conversationID] = text
            persistDrafts($0.conversationDrafts)
        }
    }

    private func retryUncertainAction(_ actionID: String) {
        guard let pending = state.pendingActions.values.first(where: { $0.actionID == actionID }),
              pending.accountID == currentAccountID,
              inFlightActionIDs.insert(actionID).inserted else { return }
        launch { [weak self] in
            guard let self else { return }
            await self.performBusy {
                await self.executePendingAction(pending, retry: true)
            }
        }
    }

    private func executePendingAction(_ action: TabletPendingAction, retry: Bool) async {
        let generation = accountGeneration
        defer { if generation == accountGeneration { inFlightActionIDs.remove(action.actionID) } }
        guard action.accountID == currentAccountID,
              state.pendingActions[action.scope]?.actionID == action.actionID else { return }
        do {
            guard let supervisor else { throw ClientFailure.invalidResponse }
            let result = try await supervisor.perform(action, mode: state.connectionMode)
            guard generation == accountGeneration, action.accountID == currentAccountID else { return }
            switch action.operation {
            case .createConversation:
                guard let result else { throw ClientFailure.invalidResponse }
                clearPendingAction(action)
                update { $0.route = result.target; $0.errorMessage = nil; $0.createSessionErrorMessage = nil }
                await refreshSnapshot()
                guard generation == accountGeneration else { return }
                if case .conversation(let computerID, let conversationID) = result.target {
                    loadConversation(computerID: computerID, conversationID: conversationID)
                }
            case .sendTurn:
                clearPendingAction(action)
                if state.conversationDrafts[action.conversationID ?? ""]?.trimmingCharacters(in: .whitespacesAndNewlines) == action.input {
                    update {
                        $0.conversationDrafts.removeValue(forKey: action.conversationID ?? "")
                        persistDrafts($0.conversationDrafts)
                    }
                }
                update { $0.errorMessage = nil }
                if let conversationID = action.conversationID {
                    loadConversation(computerID: action.computerID, conversationID: conversationID)
                }
            }
        } catch {
            guard generation == accountGeneration, action.accountID == currentAccountID else { return }
            let explicitlyRejected = SupervisorClient.isExplicitWriteRejection(error)
            let uncertain = (error as? SupervisorClientError)?.uncertainActionID == action.actionID
            let definite = SupervisorClient.isDefiniteWriteFailure(error)
            if explicitlyRejected || (!retry && !uncertain && definite) {
                clearPendingAction(action)
            }
            inFlightActionIDs.remove(action.actionID)
            switch action.operation {
            case .createConversation:
                update { $0.createSessionErrorMessage = error.localizedDescription }
            case .sendTurn:
                show(error)
            }
        }
    }

    private func setPendingAction(_ action: TabletPendingAction) {
        update { $0.pendingActions[action.scope] = action }
        persistPendingActions(state.pendingActions)
    }

    private func clearPendingAction(_ action: TabletPendingAction) {
        guard currentAccountID == action.accountID,
              state.pendingActions[action.scope]?.actionID == action.actionID else { return }
        update { $0.pendingActions.removeValue(forKey: action.scope) }
        persistPendingActions(state.pendingActions)
    }

    private func persistDrafts(_ drafts: [String: String]) {
        guard let currentAccountID,
              let data = try? JSONEncoder().encode(StoredTabletDrafts(accountID: currentAccountID, drafts: drafts)) else { return }
        defaults.set(data, forKey: Self.conversationDraftsKey)
    }

    private func persistPendingActions(_ actions: [TabletActionScope: TabletPendingAction]) {
        guard let currentAccountID else { return }
        guard !actions.isEmpty else {
            defaults.removeObject(forKey: Self.pendingActionsKey)
            return
        }
        let stored = StoredTabletActions(accountID: currentAccountID, actions: Array(actions.values))
        guard let data = try? JSONEncoder().encode(stored) else { return }
        defaults.set(data, forKey: Self.pendingActionsKey)
    }

    private func setAccount(_ accountID: String) {
        guard currentAccountID != accountID else { return }
        currentAccountID = accountID
        var drafts: [String: String] = [:]
        if let data = defaults.data(forKey: Self.conversationDraftsKey),
           let stored = try? JSONDecoder().decode(StoredTabletDrafts.self, from: data),
           stored.accountID == accountID {
            drafts = stored.drafts
        } else {
            defaults.removeObject(forKey: Self.conversationDraftsKey)
        }
        var pending: [TabletActionScope: TabletPendingAction] = [:]
        if let data = defaults.data(forKey: Self.pendingActionsKey),
           let stored = try? JSONDecoder().decode(StoredTabletActions.self, from: data),
           stored.accountID == accountID {
            for action in stored.actions where action.accountID == accountID {
                pending[action.scope] = action
            }
        } else {
            defaults.removeObject(forKey: Self.pendingActionsKey)
        }
        update {
            $0.conversationDrafts = drafts
            $0.pendingActions = pending
        }
    }

    private func clearAccountData() {
        currentAccountID = nil
        defaults.removeObject(forKey: Self.conversationDraftsKey)
        defaults.removeObject(forKey: Self.pendingActionsKey)
    }

    private func approve(attentionID: String, accepted: Bool) {
        let generation = accountGeneration
        launch { [weak self] in
            guard let self else { return }
            do {
                try await self.supervisor?.approve(attentionID: attentionID, accepted: accepted, mode: self.state.connectionMode)
                guard generation == self.accountGeneration else { return }
                await self.refreshSnapshot()
            } catch {
                guard generation == self.accountGeneration else { return }
                self.show(error)
            }
        }
    }

    private func resolveAttention(attentionID: String) {
        let generation = accountGeneration
        launch { [weak self] in
            guard let self else { return }
            do {
                try await self.supervisor?.resolveAttention(attentionID: attentionID, mode: self.state.connectionMode)
                guard generation == self.accountGeneration else { return }
                await self.refreshSnapshot()
            } catch {
                guard generation == self.accountGeneration else { return }
                self.show(error)
            }
        }
    }

    private func interrupt(conversationID: String, turnID: String) {
        guard let detail = state.activeConversation, detail.summary.id == conversationID else { return }
        let generation = accountGeneration
        launch { [weak self] in
            guard let self else { return }
            do {
                try await self.supervisor?.interrupt(
                    computerID: detail.summary.computerID, conversationID: conversationID,
                    turnID: turnID, mode: self.state.connectionMode
                )
                guard generation == self.accountGeneration else { return }
                self.loadConversation(computerID: detail.summary.computerID, conversationID: conversationID)
            } catch {
                guard generation == self.accountGeneration else { return }
                self.show(error)
            }
        }
    }

    private func archive(conversationID: String) {
        guard let detail = state.activeConversation, detail.summary.id == conversationID else { return }
        let computerID = detail.summary.computerID
        let generation = accountGeneration
        launch { [weak self] in
            guard let self else { return }
            do {
                try await self.supervisor?.archive(computerID: computerID, conversationID: conversationID, mode: self.state.connectionMode)
                guard generation == self.accountGeneration else { return }
                self.update { $0.activeConversation = nil; $0.route = .home }
                await self.refreshSnapshot()
            } catch {
                guard generation == self.accountGeneration else { return }
                self.show(error)
            }
        }
    }

    private func loadChanges(conversationID: String) {
        guard let detail = state.activeConversation, detail.summary.id == conversationID else { return }
        let computerID = detail.summary.computerID
        let generation = accountGeneration
        update { $0.changesLoading = true }
        launch { [weak self] in
            guard let self else { return }
            defer {
                if generation == self.accountGeneration {
                    self.update { $0.changesLoading = false }
                }
            }
            do {
                let files = try await self.supervisor?.changes(
                    computerID: computerID, conversationID: conversationID, mode: self.state.connectionMode
                ) ?? []
                guard generation == self.accountGeneration else { return }
                self.update { $0.changes = files }
            } catch {
                guard generation == self.accountGeneration else { return }
                self.show(error)
            }
        }
    }

    private func loadOlder(conversationID: String, cursor: String) {
        guard let detail = state.activeConversation, detail.summary.id == conversationID else { return }
        let computerID = detail.summary.computerID
        let generation = accountGeneration
        launch { [weak self] in
            guard let self else { return }
            do {
                let older = try await self.supervisor?.olderHistory(
                    computerID: computerID, conversationID: conversationID, cursor: cursor,
                    mode: self.state.connectionMode
                ) ?? (messages: [], beforeCursor: nil)
                guard generation == self.accountGeneration else { return }
                guard let current = self.state.activeConversation, current.summary.id == conversationID else { return }
                self.update {
                    $0.activeConversation = TabletConversationDetail(
                        summary: current.summary,
                        messages: older.messages,
                        attentions: current.attentions,
                        canSend: current.canSend,
                        canArchive: current.canArchive,
                        canInterrupt: current.canInterrupt,
                        canViewChanges: current.canViewChanges,
                        isRunning: current.isRunning,
                        currentTurnID: current.currentTurnID,
                        lastFailure: current.lastFailure,
                        olderCursor: older.beforeCursor
                    )
                }
            } catch {
                guard generation == self.accountGeneration else { return }
                self.show(error)
            }
        }
    }

    private func search(_ query: String) {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let results = state.computers.flatMap(\.machines).flatMap(\.recent)
            .filter { needle.isEmpty || $0.title.localizedCaseInsensitiveContains(needle) }
        update { $0.searchResults = results }
    }

    private func startPolling() {
        guard pollTask == nil else { return }
        pollTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 750_000_000)
                guard let self, !Task.isCancelled else { return }
                await self.pollForeground()
            }
        }
    }

    private func pollForeground() async {
        guard state.isAuthenticated else { return }
        let generation = accountGeneration
        if case .conversation(let computerID, let conversationID) = state.route {
            do {
                if let detail = try await supervisor?.pollConversation(
                    computerID: computerID, conversationID: conversationID, mode: state.connectionMode
                ) {
                    guard generation == accountGeneration else { return }
                    update { $0.activeConversation = detail; $0.attentions = merge($0.attentions, detail.attentions) }
                }
            } catch {
                guard generation == accountGeneration else { return }
                show(error)
            }
        }
        guard generation == accountGeneration else { return }
        if Date().timeIntervalSince(lastWorkspaceRefresh) >= 10 {
            await refreshSnapshot()
        }
    }

    private func merge(_ current: [TabletAttention], _ updates: [TabletAttention]) -> [TabletAttention] {
        var values = Dictionary(uniqueKeysWithValues: current.map { ($0.id, $0) })
        for item in updates { values[item.id] = item }
        return Array(values.values)
    }

    private func performBusy(_ operation: () async -> Void) async {
        let generation = accountGeneration
        busyCount += 1
        update { $0.isBusy = true }
        defer {
            if generation == accountGeneration {
                busyCount -= 1
                update { $0.isBusy = busyCount > 0 }
            }
        }
        await operation()
    }

    private func show(_ error: Error) {
        let authorizationWasRevoked: Bool
        if let failure = error as? SupervisorClientError {
            authorizationWasRevoked = failure.code == "computer_removed" ||
                (failure.code == "authorization_revoked" && failure.status == 409)
        } else if let failure = error as? ClientFailure, case .computerRemoved = failure {
            authorizationWasRevoked = true
        } else {
            authorizationWasRevoked = false
        }
        if authorizationWasRevoked {
            update {
                $0.isRemoved = true
                $0.removedComputerName = $0.computers.first(where: { !$0.available })?.name ?? ""
                $0.activeConversation = nil
                $0.route = .devices
                $0.errorMessage = nil
            }
            return
        }
        update { $0.errorMessage = error.localizedDescription }
    }

    private func launch(_ operation: @escaping @MainActor () async -> Void) {
        let id = UUID()
        let task = Task { @MainActor [weak self] in
            guard let self else { return }
            await operation()
            self.operationTasks.removeValue(forKey: id)
        }
        operationTasks[id] = task
    }

    private func update(_ mutate: (inout TabletViewState) -> Void) {
        var next = state
        mutate(&next)
        state = next
    }

    private static let conversationDraftsKey = "tablet.conversationDrafts"
    private static let pendingActionsKey = "tablet.pendingActions"

    private static func newActionID() -> String {
        "act_\(UUID().uuidString.lowercased())"
    }

    #if DEBUG
    private static func newSessionFailureFixture() -> [TabletComputer] {
        let project = TabletProject(
            id: "proj_ui_test", computerID: "host_ui_test", machineID: "machine_ui_test",
            name: "验收测试项目", available: true, sessions: []
        )
        let provider = TabletProvider(
            id: "codex", name: "Codex", status: "available", canStart: true,
            canApprove: false, canInterrupt: false, canViewChanges: false,
            reasoningOptions: [], unavailableReason: nil
        )
        let machine = TabletMachine(
            id: "machine_ui_test", name: "验收测试设备", platform: "iPadOS Simulator",
            status: "online", isLocal: false, projects: [project], recent: [], providers: [provider]
        )
        return [TabletComputer(
            id: "host_ui_test", name: "验收测试设备", platform: "iPadOS",
            lastUsed: "刚刚", available: true, canControl: true,
            authorizationExpiresAt: "2099-01-01T00:00:00Z", machines: [machine]
        )]
    }
    #endif
}
