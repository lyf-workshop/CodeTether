import Combine
import SwiftUI

@MainActor
final class TabletAppModel: ObservableObject {
    @Published private(set) var state: TabletViewState

    private var account: AccountClient?
    private var supervisor: SupervisorClient?
    private var pollTask: Task<Void, Never>?
    private var pairingTask: Task<Void, Never>?
    private var operationTasks: [UUID: Task<Void, Never>] = [:]
    private var busyCount = 0
    private var lastWorkspaceRefresh = Date.distantPast
    private var bootstrapped = false

    init(defaults: UserDefaults = .standard) {
        var initial = TabletViewState()
        initial.appearance = TabletAppearance(rawValue: defaults.string(forKey: "tablet.appearance") ?? "") ?? .system
        initial.connectionMode = TabletConnectionMode(rawValue: defaults.string(forKey: "tablet.connectionMode") ?? "") ?? .automatic
        initial.expandedSidebarIDs = Set(defaults.stringArray(forKey: "tablet.expandedSidebarIDs") ?? [])
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
        guard !bootstrapped else { return }
        bootstrapped = true
        do {
            try configureClients()
            if let profile = try await account?.restore() {
                update {
                    $0.isAuthenticated = true
                    $0.email = profile.email
                }
                await refreshSnapshot()
            }
        } catch {
            show(error)
        }
    }

    func taskDidStart() {
        startPolling()
    }

    func sceneChanged(_ phase: ScenePhase) {
        if phase == .active {
            launch { [weak self] in
                guard let self else { return }
                await self.start()
                if self.state.isAuthenticated { await self.refreshSnapshot() }
                self.startPolling()
            }
        } else {
            pollTask?.cancel()
            pollTask = nil
            pairingTask?.cancel()
            for task in operationTasks.values { task.cancel() }
            operationTasks.removeAll()
            launch { [weak self] in await self?.supervisor?.disconnectAll() }
        }
    }

    private func configureClients() throws {
        guard account == nil else { return }
        let configuration = try IpadConfiguration()
        let account = AccountClient(configuration: configuration, crypto: IpadMobileCryptoAdapter())
        self.account = account
        supervisor = SupervisorClient(account: account, connector: SupervisorMobileConnector())
    }

    private func requestSignInCode(_ email: String) {
        launch { [weak self] in
            guard let self else { return }
            await self.performBusy {
                do {
                    try self.configureClients()
                    try await self.account?.requestSignInCode(email: email)
                    self.update {
                        $0.email = email.trimmingCharacters(in: .whitespacesAndNewlines)
                        $0.codeRequested = true
                        $0.errorMessage = nil
                    }
                } catch { self.show(error) }
            }
        }
    }

    private func verifySignInCode(_ email: String, _ code: String) {
        launch { [weak self] in
            guard let self else { return }
            await self.performBusy {
                do {
                    try self.configureClients()
                    let profile = try await self.account?.verifySignInCode(email: email, code: code)
                    guard let profile else { throw ClientFailure.invalidResponse }
                    self.update {
                        $0.isAuthenticated = true
                        $0.email = profile.email
                        $0.codeRequested = false
                        $0.errorMessage = nil
                    }
                    await self.refreshSnapshot()
                } catch { self.show(error) }
            }
        }
    }

    private func signOut() {
        launch { [weak self] in
            guard let self else { return }
            await self.account?.signOut()
            await self.supervisor?.disconnectAll()
            self.update {
                $0.isAuthenticated = false
                $0.codeRequested = false
                $0.computers = []
                $0.attentions = []
                $0.activeConversation = nil
                $0.route = .home
                $0.errorMessage = nil
            }
        }
    }

    private func pair(_ code: String) {
        guard pairingTask == nil else { return }
        pairingTask = Task { @MainActor [weak self] in
            guard let self else { return }
            await self.performBusy {
                do {
                    guard let account = self.account else { throw ClientFailure.signInRequired }
                    self.update { $0.pairingMessage = nil }
                    _ = try await account.pair(code: code) { [weak self] in
                        Task { @MainActor in self?.update { $0.pairingMessage = "已提交配对请求，正在等待电脑确认。" } }
                    }
                    self.update { $0.pairingMessage = nil; $0.isRemoved = false }
                    await self.refreshSnapshot()
                } catch is CancellationError {
                    self.update { $0.pairingMessage = "已取消等待。" }
                } catch {
                    self.update { $0.pairingMessage = error.localizedDescription }
                }
            }
            self.pairingTask = nil
        }
    }

    private func cancelPair() {
        pairingTask?.cancel()
    }

    private func removeComputer(_ id: String) {
        launch { [weak self] in
            guard let self else { return }
            await self.performBusy {
                do {
                    try await self.account?.remove(computerID: id)
                    self.update {
                        $0.computers.removeAll { $0.id == id }
                        if case .device(let computerID, _) = $0.route, computerID == id { $0.route = .devices }
                        if case .project(let computerID, _) = $0.route, computerID == id { $0.route = .devices }
                        if case .conversation(let computerID, _) = $0.route, computerID == id {
                            $0.route = .devices
                            $0.activeConversation = nil
                        }
                    }
                } catch { self.show(error) }
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
        UserDefaults.standard.set(Array(ids), forKey: "tablet.expandedSidebarIDs")
    }

    private func setAppearance(_ appearance: TabletAppearance) {
        update { $0.appearance = appearance }
        UserDefaults.standard.set(appearance.rawValue, forKey: "tablet.appearance")
    }

    private func setConnectionMode(_ mode: TabletConnectionMode) {
        update { $0.connectionMode = mode }
        UserDefaults.standard.set(mode.rawValue, forKey: "tablet.connectionMode")
        refresh()
    }

    private func refresh() {
        launch { [weak self] in await self?.refreshSnapshot() }
    }

    private func refreshSnapshot() async {
        guard state.isAuthenticated, let supervisor else { return }
        await performBusy {
            do {
                let snapshot = try await supervisor.refresh(mode: self.state.connectionMode)
                self.apply(snapshot)
            } catch {
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
        launch { [weak self] in
            guard let self else { return }
            do {
                let detail = try await self.supervisor?.conversation(
                    computerID: computerID, conversationID: conversationID, mode: self.state.connectionMode
                )
                if let detail { self.update { $0.activeConversation = detail } }
            } catch { self.show(error) }
        }
    }

    private func createConversation(projectID: String, provider: String, reasoning: String?, input: String) {
        launch { [weak self] in
            guard let self else { return }
            await self.performBusy {
                do {
                    let result = try await self.supervisor?.createConversation(
                        projectID: projectID, provider: provider, reasoning: reasoning, input: input,
                        mode: self.state.connectionMode
                    )
                    guard let result else { throw ClientFailure.invalidResponse }
                    self.update { $0.route = result.target }
                    await self.refreshSnapshot()
                    if case .conversation(let computerID, let conversationID) = result.target {
                        self.loadConversation(computerID: computerID, conversationID: conversationID)
                    }
                } catch { self.show(error) }
            }
        }
    }

    private func send(conversationID: String, text: String) {
        guard let detail = state.activeConversation, detail.summary.id == conversationID else { return }
        let computerID = detail.summary.computerID
        launch { [weak self] in
            guard let self else { return }
            do {
                try await self.supervisor?.send(
                    computerID: computerID, conversationID: conversationID, text: text,
                    mode: self.state.connectionMode
                )
                if self.state.conversationDrafts[conversationID]?.trimmingCharacters(in: .whitespacesAndNewlines) == text {
                    self.update { $0.conversationDrafts.removeValue(forKey: conversationID) }
                }
                self.loadConversation(computerID: computerID, conversationID: conversationID)
            } catch { self.show(error) }
        }
    }

    private func updateDraft(conversationID: String, text: String) {
        update { $0.conversationDrafts[conversationID] = text }
    }

    private func approve(attentionID: String, accepted: Bool) {
        launch { [weak self] in
            guard let self else { return }
            do {
                try await self.supervisor?.approve(attentionID: attentionID, accepted: accepted, mode: self.state.connectionMode)
                await self.refreshSnapshot()
            } catch { self.show(error) }
        }
    }

    private func resolveAttention(attentionID: String) {
        launch { [weak self] in
            guard let self else { return }
            do {
                try await self.supervisor?.resolveAttention(attentionID: attentionID, mode: self.state.connectionMode)
                await self.refreshSnapshot()
            } catch { self.show(error) }
        }
    }

    private func interrupt(conversationID: String, turnID: String) {
        guard let detail = state.activeConversation, detail.summary.id == conversationID else { return }
        launch { [weak self] in
            guard let self else { return }
            do {
                try await self.supervisor?.interrupt(
                    computerID: detail.summary.computerID, conversationID: conversationID,
                    turnID: turnID, mode: self.state.connectionMode
                )
                self.loadConversation(computerID: detail.summary.computerID, conversationID: conversationID)
            } catch { self.show(error) }
        }
    }

    private func archive(conversationID: String) {
        guard let detail = state.activeConversation, detail.summary.id == conversationID else { return }
        let computerID = detail.summary.computerID
        launch { [weak self] in
            guard let self else { return }
            do {
                try await self.supervisor?.archive(computerID: computerID, conversationID: conversationID, mode: self.state.connectionMode)
                self.update { $0.activeConversation = nil; $0.route = .home }
                await self.refreshSnapshot()
            } catch { self.show(error) }
        }
    }

    private func loadChanges(conversationID: String) {
        guard let detail = state.activeConversation, detail.summary.id == conversationID else { return }
        let computerID = detail.summary.computerID
        update { $0.changesLoading = true }
        launch { [weak self] in
            guard let self else { return }
            defer { self.update { $0.changesLoading = false } }
            do {
                let files = try await self.supervisor?.changes(
                    computerID: computerID, conversationID: conversationID, mode: self.state.connectionMode
                ) ?? []
                self.update { $0.changes = files }
            } catch { self.show(error) }
        }
    }

    private func loadOlder(conversationID: String, cursor: String) {
        guard let detail = state.activeConversation, detail.summary.id == conversationID else { return }
        let computerID = detail.summary.computerID
        launch { [weak self] in
            guard let self else { return }
            do {
                let older = try await self.supervisor?.olderHistory(
                    computerID: computerID, conversationID: conversationID, cursor: cursor,
                    mode: self.state.connectionMode
                ) ?? (messages: [], beforeCursor: nil)
                guard let current = self.state.activeConversation, current.summary.id == conversationID else { return }
                self.update {
                    $0.activeConversation = TabletConversationDetail(
                        summary: current.summary,
                        messages: older.messages + current.messages,
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
            } catch { self.show(error) }
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
        if case .conversation(let computerID, let conversationID) = state.route {
            do {
                if let detail = try await supervisor?.pollConversation(
                    computerID: computerID, conversationID: conversationID, mode: state.connectionMode
                ) {
                    update { $0.activeConversation = detail; $0.attentions = merge($0.attentions, detail.attentions) }
                }
            } catch { show(error) }
        }
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
        busyCount += 1
        update { $0.isBusy = true }
        defer {
            busyCount -= 1
            update { $0.isBusy = busyCount > 0 }
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
}
