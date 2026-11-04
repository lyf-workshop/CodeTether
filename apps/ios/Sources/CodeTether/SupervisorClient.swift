import Foundation

struct SupervisorWireFailure: Error {
    let code: String
    let status: Int?
}

protocol SupervisorWireSession: Sendable {
    var transport: String { get }
    var control: Bool { get }
    var expiresAt: String { get }
    func request(_ json: String) async throws -> String
    func close() async
}

protocol SupervisorConnector: Sendable {
    func connect(_ context: SupervisorConnectContext, mode: TabletConnectionMode) async throws -> any SupervisorWireSession
}

struct SupervisorSnapshot {
    let computers: [TabletComputer]
    let attentions: [TabletAttention]
    let selectedTransport: String
    let connectedComputerCount: Int
}

struct SupervisorCreateResult {
    let computerID: String
    let target: TabletRoute
}

struct SupervisorClientError: Error, LocalizedError {
    let code: String
    let status: Int?
    let uncertainActionID: String?

    var errorDescription: String? {
        if let uncertainActionID { return ClientFailure.actionUncertain(uncertainActionID).localizedDescription }
        if code == "computer_removed" { return ClientFailure.computerRemoved.localizedDescription }
        if code == "authorization_revoked", status == 409 { return ClientFailure.computerRemoved.localizedDescription }
        if code == "operation_not_allowed" { return ClientFailure.operationNotAllowed.localizedDescription }
        if code == "unsupported" { return ClientFailure.unsupported.localizedDescription }
        if code == "archive_busy" || status == 409 { return ClientFailure.archiveBusy.localizedDescription }
        if code == "sign_in_required" { return ClientFailure.signInRequired.localizedDescription }
        if code == "configuration_missing" { return ClientFailure.configurationMissing.localizedDescription }
        if code == "invalid_response" || code == "invalid_request" { return ClientFailure.invalidResponse.localizedDescription }
        return ClientFailure.computerUnavailable.localizedDescription
    }
}

actor SupervisorClient {
    private struct ActiveConnection {
        let wire: any SupervisorWireSession
        let computer: PairedComputer
        let control: Bool
        let mode: TabletConnectionMode
    }

    private struct ConversationTarget: Hashable {
        let machineID: String
        let projectID: String
        let conversationID: String

        var fields: [String: Any] {
            ["machineId": machineID, "projectId": projectID, "conversationId": conversationID]
        }
    }

    private struct ProjectTarget {
        let computerID: String
        let machineID: String
        let projectID: String
    }

    private let account: AccountClient
    private let connector: any SupervisorConnector
    private var active: [String: ActiveConnection] = [:]
    private var conversationTargets: [String: (computerID: String, target: ConversationTarget)] = [:]
    private var projectTargets: [String: ProjectTarget] = [:]
    private var attentionRecords: [String: (computerID: String, record: [String: Any])] = [:]
    private var liveCursors: [String: String] = [:]

    init(account: AccountClient, connector: any SupervisorConnector) {
        self.account = account
        self.connector = connector
    }

    func refresh(mode: TabletConnectionMode) async throws -> SupervisorSnapshot {
        let directory = try await account.directory()
        var computers: [TabletComputer] = []
        var attentions: [TabletAttention] = []
        var selectedTransport = ""
        var connected = 0

        for computer in directory {
            do {
                let session = try await ensureConnected(computerID: computer.id, mode: mode)
                let workspace = try await readWorkspace(computer: computer, session: session, mode: mode)
                computers.append(workspace.computer)
                attentions.append(contentsOf: workspace.attentions)
                if selectedTransport.isEmpty { selectedTransport = session.wire.transport }
                connected += 1
            } catch {
                await close(computerID: computer.id)
                computers.append(TabletComputer(
                    id: computer.id, name: computer.name, platform: computer.platform,
                    lastUsed: Self.relativeTime(computer.lastUsedAt), available: false,
                    canControl: computer.canControl, authorizationExpiresAt: computer.expiresAt,
                    machines: []
                ))
            }
        }
        return SupervisorSnapshot(
            computers: computers, attentions: attentions,
            selectedTransport: selectedTransport, connectedComputerCount: connected
        )
    }

    func disconnectAll() async {
        let existing = active.values.map(\.wire)
        active.removeAll()
        for wire in existing { await wire.close() }
    }

    func connectContext(computerID: String, mode: TabletConnectionMode) async throws -> String {
        let session = try await ensureConnected(computerID: computerID, mode: mode)
        return session.wire.transport
    }

    func conversation(computerID: String, conversationID: String, mode: TabletConnectionMode) async throws -> TabletConversationDetail {
        guard let context = conversationTargets[conversationID], context.computerID == computerID else {
            throw ClientFailure.invalidResponse
        }
        let session = try await ensureConnected(computerID: computerID, mode: mode)
        return try await readConversation(session: session, target: context.target, mode: mode)
    }

    func pollConversation(computerID: String, conversationID: String, mode: TabletConnectionMode) async throws -> TabletConversationDetail? {
        guard let context = conversationTargets[conversationID], context.computerID == computerID,
              let cursor = liveCursors[conversationID] else { return nil }
        let session = try await ensureConnected(computerID: computerID, mode: mode)
        let page = try await readSizedPage(computerID: computerID, mode: mode, initialLimit: 16) { limit in
            try await self.request(
                computerID: computerID, mode: mode, operation: "conversation.live.read",
                fields: context.target.fields.merging(["cursor": cursor, "limit": limit, "waitMs": 0]) { _, next in next }
            )
        }
        guard page.object?["conversationId"] as? String == conversationID else { throw ClientFailure.invalidResponse }
        let events = page.array("events")
        if page.object?["resetRequired"] as? Bool == true || !events.isEmpty {
            return try await readConversation(session: session, target: context.target, mode: mode)
        }
        return nil
    }

    func createConversation(
        projectID: String,
        provider: String,
        reasoning: String?,
        input: String,
        mode: TabletConnectionMode
    ) async throws -> SupervisorCreateResult {
        guard let project = projectTargets[projectID] else { throw ClientFailure.invalidResponse }
        guard !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw ClientFailure.invalidResponse }
        _ = try await ensureConnected(computerID: project.computerID, mode: mode)
        let machine = try await request(
            computerID: project.computerID, mode: mode, operation: "machine.get", fields: ["machineId": project.machineID]
        )
        let providers = machine.object?["providers"] as? [[String: Any]] ?? []
        guard let tool = providers.first(where: { $0["provider"] as? String == provider }),
              tool["availability"] as? String == "available",
              ((tool["executionHealth"] as? [String: Any])?["state"] as? String) != "unavailable" else {
            throw ClientFailure.unsupported
        }
        let capabilities = tool["capabilities"] as? [String: Any] ?? [:]
        guard capabilities["providerExecution"] as? Bool == true else { throw ClientFailure.unsupported }
        let actionID = Self.newActionID()
        var fields: [String: Any] = [
            "machineId": project.machineID, "projectId": project.projectID, "provider": provider,
            "input": ["type": "text", "text": input], "actionId": actionID,
        ]
        if let reasoning { fields["reasoning"] = reasoning }
        let result = try await mutate(
            computerID: project.computerID, mode: mode, operation: "conversation.create", fields: fields, actionID: actionID
        )
        guard let data = result.object?["data"] as? [String: Any],
              let conversation = data["conversation"] as? [String: Any],
              let target = try? Self.parseTarget(conversation),
              target.projectID == project.projectID, target.machineID == project.machineID else {
            throw ClientFailure.invalidResponse
        }
        conversationTargets[target.conversationID] = (project.computerID, target)
        return SupervisorCreateResult(
            computerID: project.computerID,
            target: .conversation(computerID: project.computerID, conversationID: target.conversationID)
        )
    }

    func send(computerID: String, conversationID: String, text: String, mode: TabletConnectionMode) async throws {
        guard let context = conversationTargets[conversationID], context.computerID == computerID else {
            throw ClientFailure.invalidResponse
        }
        let actionID = Self.newActionID()
        _ = try await mutate(
            computerID: computerID, mode: mode, operation: "conversation.turn.start",
            fields: context.target.fields.merging(["input": ["type": "text", "text": text]]) { _, next in next },
            actionID: actionID
        )
    }

    func approve(attentionID: String, accepted: Bool, mode: TabletConnectionMode) async throws {
        guard let (computerID, cached) = attentionRecords[attentionID] else { throw ClientFailure.invalidResponse }
        let approvalID: String
        if let payload = cached["payload"] as? [String: Any], let value = payload["approvalId"] as? String {
            approvalID = value
        } else { throw ClientFailure.invalidResponse }
        let actionID = Self.newActionID()
        _ = try await mutate(
            computerID: computerID, mode: mode, operation: "approval.resolve",
            fields: ["approvalId": approvalID, "decision": accepted ? "accept" : "decline"], actionID: actionID
        )
    }

    func resolveAttention(attentionID: String, mode: TabletConnectionMode) async throws {
        guard let (computerID, cached) = attentionRecords[attentionID],
              ["completed_review", "failed"].contains(cached["type"] as? String ?? "") else {
            throw ClientFailure.unsupported
        }
        let actionID = Self.newActionID()
        _ = try await mutate(
            computerID: computerID, mode: mode, operation: "attention.resolve",
            fields: ["attentionId": attentionID], actionID: actionID
        )
    }

    func interrupt(computerID: String, conversationID: String, turnID: String, mode: TabletConnectionMode) async throws {
        guard let context = conversationTargets[conversationID], context.computerID == computerID else {
            throw ClientFailure.invalidResponse
        }
        let session = try await ensureConnected(computerID: computerID, mode: mode)
        let detail = try await readConversation(session: session, target: context.target, mode: mode)
        guard detail.canInterrupt else { throw ClientFailure.unsupported }
        let actionID = Self.newActionID()
        _ = try await mutate(
            computerID: computerID, mode: mode, operation: "turn.interrupt",
            fields: context.target.fields.merging(["turnId": turnID]) { _, next in next }, actionID: actionID
        )
    }

    func archive(computerID: String, conversationID: String, mode: TabletConnectionMode) async throws {
        guard let context = conversationTargets[conversationID], context.computerID == computerID else {
            throw ClientFailure.invalidResponse
        }
        let actionID = Self.newActionID()
        do {
            _ = try await mutate(
                computerID: computerID, mode: mode, operation: "conversation.archive",
                fields: context.target.fields, actionID: actionID
            )
        } catch let failure as SupervisorClientError where failure.status == 409 || failure.code == "conflict" {
            throw ClientFailure.archiveBusy
        }
    }

    func changes(computerID: String, conversationID: String, mode: TabletConnectionMode) async throws -> [TabletDiffFile] {
        guard let context = conversationTargets[conversationID], context.computerID == computerID else {
            throw ClientFailure.invalidResponse
        }
        let session = try await ensureConnected(computerID: computerID, mode: mode)
        let detail = try await readConversation(session: session, target: context.target, mode: mode)
        guard detail.canViewChanges else { throw ClientFailure.unsupported }
        var all: [[String: Any]] = []
        var offset = 0
        while true {
            let page = try await request(
                computerID: computerID, mode: mode, operation: "conversation.changes",
                fields: context.target.fields.merging(["offset": offset]) { _, next in next }
            )
            guard page.object?["conversationId"] as? String == conversationID else { throw ClientFailure.invalidResponse }
            all.append(contentsOf: page.array("changes"))
            guard let next = page.object?["nextOffset"] as? Int else { break }
            guard next > offset, next <= 2048, all.count <= 2048 else { throw ClientFailure.invalidResponse }
            offset = next
        }
        return try all.map(Self.parseDiffFile)
    }

    func olderHistory(computerID: String, conversationID: String, cursor: String, mode: TabletConnectionMode) async throws -> (messages: [TabletTimelineMessage], beforeCursor: String?) {
        guard let context = conversationTargets[conversationID], context.computerID == computerID else {
            throw ClientFailure.invalidResponse
        }
        let page = try await readSizedPage(computerID: computerID, mode: mode, initialLimit: 8) { limit in
            try await self.request(
                computerID: computerID, mode: mode, operation: "conversation.history",
                fields: context.target.fields.merging(["limit": limit, "cursor": cursor]) { _, next in next }
            )
        }
        let parsed = try Self.parseHistory(page.object ?? [:], target: context.target)
        return (parsed.messages, parsed.beforeCursor)
    }

    private func ensureConnected(computerID: String, mode: TabletConnectionMode, force: Bool = false) async throws -> ActiveConnection {
        if !force, let current = active[computerID], current.control,
           (mode == .automatic || current.mode == mode),
           let expiry = ISO8601DateFormatter().date(from: current.wire.expiresAt), expiry > Date().addingTimeInterval(3) {
            return current
        }
        if let old = active.removeValue(forKey: computerID) { await old.wire.close() }
        let context = try await account.connectContext(computerID: computerID, mode: mode)
        do {
            let wire = try await connector.connect(context, mode: mode)
            guard wire.control else { await wire.close(); throw ClientFailure.operationNotAllowed }
            let result = ActiveConnection(wire: wire, computer: context.computer, control: wire.control, mode: mode)
            active[computerID] = result
            return result
        } catch let failure as SupervisorWireFailure where failure.code == "authorization_revoked" {
            let latest = try await account.connectContext(computerID: computerID, mode: mode)
            let wire = try await connector.connect(latest, mode: mode)
            guard wire.control else { await wire.close(); throw ClientFailure.operationNotAllowed }
            let result = ActiveConnection(wire: wire, computer: latest.computer, control: wire.control, mode: mode)
            active[computerID] = result
            return result
        }
    }

    private func close(computerID: String) async {
        guard let connection = active.removeValue(forKey: computerID) else { return }
        await connection.wire.close()
    }

    private func request(
        computerID: String,
        mode: TabletConnectionMode,
        operation: String,
        fields: [String: Any] = [:],
        retryRead: Bool = true,
        actionID: String? = nil
    ) async throws -> JSONResponse {
        let connection = try await ensureConnected(computerID: computerID, mode: mode)
        let requestObject = fields.merging(["operation": operation]) { current, _ in current }
        let bytes: Data
        do { bytes = try JSONSerialization.data(withJSONObject: requestObject, options: [.sortedKeys]) }
        catch { throw ClientFailure.invalidResponse }
        guard let text = String(data: bytes, encoding: .utf8) else { throw ClientFailure.invalidResponse }
        do {
            let output = try await connection.wire.request(text)
            guard let data = output.data(using: .utf8),
                  let value = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  value.isEmpty == false else { throw ClientFailure.invalidResponse }
            return JSONResponse(value)
        } catch let failure as SupervisorWireFailure {
            if actionID != nil {
                if failure.code == "connection_closed" || failure.code == "connection_failed" || failure.code == "session_expired" || failure.code == "authorization_revoked" || failure.code == "internal" {
                    await close(computerID: computerID)
                    throw SupervisorClientError(code: failure.code, status: failure.status, uncertainActionID: actionID)
                }
                throw SupervisorClientError(code: failure.code, status: failure.status, uncertainActionID: actionID)
            }
            let reconnectable: Set<String> = ["connection_closed", "connection_failed", "session_expired", "authorization_revoked", "remote_host_unreachable", "timeout"]
            guard retryRead, reconnectable.contains(failure.code) else {
                throw SupervisorClientError(code: failure.code, status: failure.status, uncertainActionID: nil)
            }
            await close(computerID: computerID)
            _ = try await ensureConnected(computerID: computerID, mode: mode, force: true)
            return try await request(
                computerID: computerID, mode: mode, operation: operation, fields: fields,
                retryRead: false, actionID: nil
            )
        }
    }

    private func mutate(
        computerID: String,
        mode: TabletConnectionMode,
        operation: String,
        fields: [String: Any],
        actionID: String
    ) async throws -> JSONResponse {
        let response = try await request(
            computerID: computerID, mode: mode, operation: operation,
            fields: fields.merging(["actionId": actionID]) { _, next in next },
            retryRead: false, actionID: actionID
        )
        guard response.object?["actionId"] as? String == actionID else {
            throw SupervisorClientError(code: "invalid_response", status: nil, uncertainActionID: actionID)
        }
        switch response.object?["status"] as? String {
        case "accepted", "completed": return response
        case "rejected": throw ClientFailure.operationNotAllowed
        default: throw SupervisorClientError(code: "invalid_response", status: nil, uncertainActionID: actionID)
        }
    }

    private func readWorkspace(computer: PairedComputer, session: ActiveConnection, mode: TabletConnectionMode) async throws -> (computer: TabletComputer, attentions: [TabletAttention]) {
        _ = try await request(computerID: computer.id, mode: mode, operation: "host.bootstrap")
        let machinePage = try await request(computerID: computer.id, mode: mode, operation: "machine.list")
        let machineRows = machinePage.array("machines")
        guard machineRows.count <= 128 else { throw ClientFailure.invalidResponse }
        var machines: [TabletMachine] = []
        var projectsForAttention: [String: TabletProject] = [:]

        for row in machineRows {
            let machineID = try Self.requiredString(row, "machineId", max: 160)
            let detailPage = try await request(computerID: computer.id, mode: mode, operation: "machine.get", fields: ["machineId": machineID])
            let detail = try Self.object(detailPage.object, "machine")
            guard detail["machineId"] as? String == machineID else { throw ClientFailure.invalidResponse }
            let machineAvailable = row["availability"] as? String == "available"
            let machineCapabilities = row["capabilities"] as? [String: Any] ?? [:]
            let canExecute = machineAvailable && machineCapabilities["providerExecution"] as? Bool == true
            let providerRows = detailPage.array("providers")
            let providers = try providerRows.map { try Self.parseProvider($0, canExecute: canExecute) }

            let projectRows = try await readPages(computerID: computer.id, mode: mode, operation: "project.list", listKey: "projects", fields: ["machineId": machineID])
            let projectAccess = machineAvailable && machineCapabilities["projectAccess"] as? Bool == true
            var projects = try projectRows.map { try Self.parseProject($0, machineID: machineID, available: projectAccess) }
            for project in projects { projectTargets[project.id] = ProjectTarget(computerID: computer.id, machineID: machineID, projectID: project.id) }

            let recentPage = try await request(computerID: computer.id, mode: mode, operation: "conversation.recent", fields: ["machineId": machineID, "limit": 30])
            let recent = try recentPage.array("conversations").map { row -> TabletConversationSummary in
                let summary = try Self.parseConversation(row, computer: computer, machineName: row["machineName"] as? String ?? (detail["displayName"] as? String ?? "设备"), projectName: projects.first(where: { $0.id == row["projectId"] as? String })?.name ?? "项目")
                guard summary.machineID == machineID else { throw ClientFailure.invalidResponse }
                conversationTargets[summary.id] = (computer.id, ConversationTarget(machineID: machineID, projectID: summary.projectID, conversationID: summary.id))
                return summary
            }
            let projectSessions = Dictionary(grouping: recent, by: \.projectID)
            projects = projects.map { project in
                TabletProject(id: project.id, computerID: computer.id, machineID: machineID, name: project.name,
                              available: project.available, sessions: Array(projectSessions[project.id, default: []].prefix(5)))
            }
            for project in projects { projectsForAttention[project.id] = project }
            machines.append(TabletMachine(
                id: machineID, name: detail["displayName"] as? String ?? "设备",
                platform: [detail["platform"] as? String, detail["architecture"] as? String].compactMap { $0 }.joined(separator: " · "),
                status: row["connectionState"] as? String ?? "offline", isLocal: row["isLocal"] as? Bool ?? false,
                projects: projects, recent: Array(recent.prefix(30)), providers: providers
            ))
        }

        let attentionPage = try await request(computerID: computer.id, mode: mode, operation: "attention.list", fields: ["status": "open", "limit": 50])
        let attentionRows = attentionPage.array("items")
        var attentions: [TabletAttention] = []
        for row in attentionRows {
            guard let projectID = row["projectId"] as? String,
                  let conversationID = row["conversationId"] as? String else { continue }
            attentionRecords[row["attentionId"] as? String ?? ""] = (computer.id, row)
            let project = projectsForAttention[projectID]
            let machine = machines.first(where: { $0.id == project?.machineID })
            let conversation = machine?.recent.first(where: { $0.id == conversationID })
            let provider = machine?.providers.first(where: { $0.id == conversation?.providerName })
            let item = try Self.parseAttention(
                row, computer: computer, project: project, conversation: conversation,
                providerCanApprove: provider?.canApprove == true, canControl: session.control
            )
            attentions.append(item)
        }
        return (
            TabletComputer(id: computer.id, name: computer.name, platform: computer.platform,
                           lastUsed: Self.relativeTime(computer.lastUsedAt), available: true, canControl: session.control,
                           authorizationExpiresAt: computer.expiresAt, machines: machines),
            attentions
        )
    }

    private func readConversation(session: ActiveConnection, target: ConversationTarget, mode: TabletConnectionMode) async throws -> TabletConversationDetail {
        let historyPage = try await readSizedPage(computerID: session.computer.id, mode: mode, initialLimit: 8) { limit in
            try await self.request(computerID: session.computer.id, mode: mode, operation: "conversation.history",
                                   fields: target.fields.merging(["limit": limit]) { _, next in next })
        }
        let summaryPage = try await request(
            computerID: session.computer.id, mode: mode, operation: "conversation.get", fields: target.fields
        )
        let conversationObject = try Self.object(summaryPage.object, "conversation")
        guard try Self.parseTarget(conversationObject) == target else { throw ClientFailure.invalidResponse }
        let machinePage = try await request(computerID: session.computer.id, mode: mode, operation: "machine.get", fields: ["machineId": target.machineID])
        let machine = try Self.object(machinePage.object, "machine")
        let providerRows = machinePage.array("providers")
        let providerRaw = providerRows.first(where: { $0["provider"] as? String == conversationObject["provider"] as? String })
        let provider = try providerRaw.map { try Self.parseProvider($0, canExecute: true) }
        let project = active[session.computer.id].flatMap { _ in
            projectTargets[target.projectID].map { $0.projectID }
        }
        let recentName = machine["displayName"] as? String ?? "设备"
        let summary = try Self.parseConversation(
            conversationObject, computer: session.computer, machineName: recentName,
            projectName: project ?? "项目"
        )
        conversationTargets[target.conversationID] = (session.computer.id, target)
        let history = try Self.parseHistory(historyPage.object ?? [:], target: target)
        liveCursors[target.conversationID] = history.liveCursor

        let attentionPage = try await request(computerID: session.computer.id, mode: mode, operation: "attention.list",
                                              fields: ["status": "open", "limit": 50, "projectId": target.projectID])
        let attentionValues = try attentionPage.array("items").filter { $0["conversationId"] as? String == target.conversationID }.map { row -> TabletAttention in
            attentionRecords[row["attentionId"] as? String ?? ""] = (session.computer.id, row)
            return try Self.parseAttention(row, computer: session.computer, project: nil, conversation: summary,
                                           providerCanApprove: provider?.canApprove == true, canControl: session.control)
        }

        let status = summary.status
        let archived = summary.isArchived
        let activeTurn = history.turns.last(where: { $0["status"] as? String == "running" })
        let currentTurnID = activeTurn?["turnId"] as? String
        let lastTurn = history.turns.last
        let failureText = lastTurn.flatMap { $0["error"] as? [String: Any] }.map(Self.friendlyFailure)
        let resumability = conversationObject["resumability"] as? String ?? "resumable"
        let canSend = session.control && !archived && resumability == "resumable" &&
            !["running", "waiting"].contains(status) && provider?.canStart == true
        let canInterrupt = session.control && provider?.canInterrupt == true && ["running", "waiting"].contains(status) && currentTurnID != nil
        return TabletConversationDetail(
            summary: summary, messages: history.messages, attentions: attentionValues,
            canSend: canSend, canArchive: session.control && !archived && !["running", "waiting"].contains(status),
            canInterrupt: canInterrupt, canViewChanges: provider?.canViewChanges == true,
            isRunning: ["running", "waiting"].contains(status), currentTurnID: currentTurnID,
            lastFailure: failureText, olderCursor: history.beforeCursor
        )
    }

    private func readPages(computerID: String, mode: TabletConnectionMode, operation: String, listKey: String, fields: [String: Any]) async throws -> [[String: Any]] {
        var result: [[String: Any]] = []
        var seen = Set<String>()
        var cursor: String?
        for _ in 0..<128 {
            var requestFields = fields.merging(["limit": 50]) { _, next in next }
            if let cursor { requestFields["cursor"] = cursor }
            let page = try await request(computerID: computerID, mode: mode, operation: operation, fields: requestFields)
            result.append(contentsOf: page.array(listKey))
            let next = page.object?["nextCursor"] as? String
            guard (page.object?["hasMore"] as? Bool) == (next != nil) else { throw ClientFailure.invalidResponse }
            guard let next else { return result }
            guard seen.insert(next).inserted else { throw ClientFailure.invalidResponse }
            cursor = next
        }
        throw ClientFailure.invalidResponse
    }

    private func readSizedPage(
        computerID: String,
        mode: TabletConnectionMode,
        initialLimit: Int,
        load: (Int) async throws -> JSONResponse
    ) async throws -> JSONResponse {
        var limit = initialLimit
        while true {
            do { return try await load(limit) }
            catch let error as SupervisorClientError where error.code == "internal" && limit > 1 { limit = max(1, limit / 2) }
            catch let error as SupervisorWireFailure where error.code == "internal" && limit > 1 { limit = max(1, limit / 2) }
        }
    }

    private static func newActionID() -> String {
        "act_" + UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
    }

    private static func parseProvider(_ row: [String: Any], canExecute: Bool) throws -> TabletProvider {
        let provider = try requiredString(row, "provider", max: 40)
        let availability = row["availability"] as? String ?? "unavailable"
        let capabilities = row["capabilities"] as? [String: Any] ?? [:]
        let health = row["executionHealth"] as? [String: Any]
        let canStart = canExecute && availability == "available" && health?["state"] as? String != "unavailable"
        let reasons = row["reasoningOptions"] as? [[String: Any]] ?? []
        return TabletProvider(
            id: provider, name: row["displayName"] as? String ?? (provider == "claude-code" ? "Claude Code" : "Codex"),
            status: availability, canStart: canStart,
            canApprove: capabilities["approvals"] as? Bool == true,
            canInterrupt: capabilities["interrupt"] as? Bool == true,
            canViewChanges: capabilities["diff"] as? Bool == true,
            reasoningOptions: try reasons.map { TabletReasoningOption(id: try requiredString($0, "id", max: 120), name: try requiredString($0, "label", max: 120)) },
            unavailableReason: canStart ? nil : providerUnavailableText(availability, health: health)
        )
    }

    private static func parseProject(_ row: [String: Any], machineID: String, available: Bool) throws -> TabletProject {
        guard row["machineId"] as? String == machineID else { throw ClientFailure.invalidResponse }
        let id = try requiredString(row, "projectId", max: 160)
        return TabletProject(id: id, computerID: "", machineID: machineID,
                             name: try requiredString(row, "name", max: 240), available: available, sessions: [])
    }

    private static func parseConversation(
        _ row: [String: Any], computer: PairedComputer, machineName: String, projectName: String
    ) throws -> TabletConversationSummary {
        let target = try parseTarget(row)
        return TabletConversationSummary(
            id: target.conversationID, computerID: computer.id, machineID: target.machineID, projectID: target.projectID,
            machineName: machineName, projectName: projectName,
            title: try requiredString(row, "title", max: 240), providerName: providerDisplayName(row["provider"] as? String),
            status: row["status"] as? String ?? "unknown", lastActivity: relativeTime(row["lastActivityAt"] as? String),
            isArchived: row["archived"] as? Bool ?? false, isImported: row["origin"] as? String == "adopted_native"
        )
    }

    private static func parseAttention(
        _ row: [String: Any], computer: PairedComputer, project: TabletProject?, conversation: TabletConversationSummary?,
        providerCanApprove: Bool, canControl: Bool
    ) throws -> TabletAttention {
        let type = try requiredString(row, "type", max: 40)
        let payload = row["payload"] as? [String: Any] ?? [:]
        let approvalID = type == "approval" ? payload["approvalId"] as? String : nil
        let attentionID = try requiredString(row, "attentionId", max: 160)
        let status = row["status"] as? String ?? "open"
        let title = type == "approval" ? (payload["actionTitle"] as? String ?? "需要你批准") : (payload["conversationTitle"] as? String ?? conversation?.title ?? "会话")
        let detail = type == "approval" ? payload["actionSubtitle"] as? String : (type == "failed" ? friendlyFailure(payload["error"] as? [String: Any] ?? [:]) : nil)
        return TabletAttention(
            id: attentionID, conversationID: row["conversationId"] as? String, computerID: computer.id,
            projectID: row["projectId"] as? String, type: type, title: title, detail: detail,
            canApprove: status == "open" && canControl && approvalID != nil && providerCanApprove,
            computerName: computer.name, projectName: project?.name ?? conversation?.projectName ?? "项目"
        )
    }

    private static func parseTarget(_ row: [String: Any]) throws -> ConversationTarget {
        ConversationTarget(
            machineID: try requiredString(row, "machineId", max: 160),
            projectID: try requiredString(row, "projectId", max: 160),
            conversationID: try requiredString(row, "conversationId", max: 160)
        )
    }

    private static func parseHistory(_ row: [String: Any], target: ConversationTarget) throws -> ParsedHistory {
        guard row["conversationId"] as? String == target.conversationID else { throw ClientFailure.invalidResponse }
        let before = row["beforeCursor"] as? String
        let complete = row["historyComplete"] as? Bool == true
        guard (row["hasMoreBefore"] as? Bool == (before != nil)), !(complete && before != nil),
              let live = row["liveCursor"] as? String else { throw ClientFailure.invalidResponse }
        switch row["source"] as? String {
        case "native_provider":
            guard let native = row["native"] as? [String: Any], native["conversationId"] as? String == target.conversationID else {
                throw ClientFailure.invalidResponse
            }
            let entries = native["entries"] as? [[String: Any]] ?? []
            let messages = try entries.map { entry -> TabletTimelineMessage in
                guard entry["conversationId"] as? String == target.conversationID else { throw ClientFailure.invalidResponse }
                let role = entry["role"] as? String ?? "assistant"
                return TabletTimelineMessage(
                    id: try requiredString(entry, "id", max: 200),
                    kind: role == "user" ? .user : .assistant,
                    text: entry["content"] as? String ?? "",
                    timestamp: entry["occurredAt"] as? String ?? ""
                )
            }
            return ParsedHistory(messages: messages, turns: [], beforeCursor: before, liveCursor: live)
        case "durable":
            guard let runtime = row["runtime"] as? [String: Any], runtime["conversationId"] as? String == target.conversationID else {
                throw ClientFailure.invalidResponse
            }
            let turns = runtime["turns"] as? [[String: Any]] ?? []
            var messages: [(Int, TabletTimelineMessage)] = []
            for turn in turns {
                guard turn["conversationId"] as? String == target.conversationID,
                      let turnID = turn["turnId"] as? String else { throw ClientFailure.invalidResponse }
                if let input = turn["input"] as? [String: Any], let text = input["text"] as? String {
                    messages.append((turn["order"] as? Int ?? Int.max - 1, TabletTimelineMessage(id: "input:\(turnID)", kind: .user, text: text, timestamp: turn["startedAt"] as? String ?? "")))
                }
                for message in (runtime["messages"] as? [[String: Any]] ?? []).filter({ $0["turnId"] as? String == turnID }) {
                    messages.append((message["order"] as? Int ?? 0, TabletTimelineMessage(
                        id: try requiredString(message, "itemId", max: 200), kind: .assistant,
                        text: message["text"] as? String ?? "", timestamp: message["timestamp"] as? String ?? ""
                    )))
                }
                for tool in (runtime["tools"] as? [[String: Any]] ?? []).filter({ $0["turnId"] as? String == turnID }) {
                    let content = tool["summary"] as? String ?? tool["outputSummary"] as? String ?? tool["name"] as? String ?? "工具活动"
                    messages.append((tool["order"] as? Int ?? 0, TabletTimelineMessage(
                        id: try requiredString(tool, "itemId", max: 200), kind: .activity,
                        text: content, timestamp: tool["startedAt"] as? String ?? ""
                    )))
                }
                if let final = turn["finalMessage"] as? String, !final.isEmpty,
                   !(runtime["messages"] as? [[String: Any]] ?? []).contains(where: { $0["turnId"] as? String == turnID }) {
                    messages.append((turn["order"] as? Int ?? 0, TabletTimelineMessage(
                        id: "final:\(turnID)", kind: .assistant, text: final,
                        timestamp: turn["completedAt"] as? String ?? turn["startedAt"] as? String ?? ""
                    )))
                }
            }
            let sorted = messages.sorted { $0.0 < $1.0 }.map(\.1)
            return ParsedHistory(messages: Array(sorted.suffix(2048)), turns: turns, beforeCursor: before, liveCursor: live)
        default: throw ClientFailure.invalidResponse
        }
    }

    private static func parseDiffFile(_ row: [String: Any]) throws -> TabletDiffFile {
        let path = try requiredString(row, "path", max: 2_048)
        let diff = row["diff"] as? String ?? ""
        let additions = row["additions"] as? Int ?? 0
        let deletions = row["deletions"] as? Int ?? 0
        let lines = parseUnifiedDiff(diff)
        return TabletDiffFile(id: path, path: path, additions: additions, deletions: deletions, lines: lines)
    }

    private static func parseUnifiedDiff(_ diff: String) -> [TabletDiffLine] {
        var oldLine: Int?
        var newLine: Int?
        var result: [TabletDiffLine] = []
        for (index, raw) in diff.split(separator: "\n", omittingEmptySubsequences: false).enumerated() {
            let text = String(raw)
            if text.hasPrefix("@@"), let range = text.range(of: "-([0-9]+)(?:,[0-9]+)? \\+([0-9]+)(?:,[0-9]+)?", options: .regularExpression) {
                let hunk = String(text[range])
                let numbers = hunk.split(whereSeparator: { !$0.isNumber }).compactMap { Int($0) }
                if numbers.count >= 2 { oldLine = numbers[0]; newLine = numbers[1] }
                result.append(TabletDiffLine(id: "line-\(index)", kind: .header, oldLine: oldLine, newLine: newLine, text: text))
            } else if text.hasPrefix("+") {
                result.append(TabletDiffLine(id: "line-\(index)", kind: .added, oldLine: nil, newLine: newLine, text: String(text.dropFirst())))
                if let next = newLine { newLine = next + 1 }
            } else if text.hasPrefix("-") {
                result.append(TabletDiffLine(id: "line-\(index)", kind: .removed, oldLine: oldLine, newLine: nil, text: String(text.dropFirst())))
                if let next = oldLine { oldLine = next + 1 }
            } else if text.hasPrefix(" ") {
                result.append(TabletDiffLine(id: "line-\(index)", kind: .context, oldLine: oldLine, newLine: newLine, text: String(text.dropFirst())))
                if let next = oldLine { oldLine = next + 1 }
                if let next = newLine { newLine = next + 1 }
            } else if text.hasPrefix("\\") {
                result.append(TabletDiffLine(id: "line-\(index)", kind: .header, oldLine: nil, newLine: nil, text: text))
            }
        }
        return result
    }

    private static func requiredString(_ object: [String: Any], _ key: String, max: Int) throws -> String {
        guard let value = object[key] as? String, !value.isEmpty, value.utf8.count <= max,
              value.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) }) else {
            throw ClientFailure.invalidResponse
        }
        return value
    }

    private static func object(_ value: [String: Any]?, _ key: String) throws -> [String: Any] {
        guard let value, let object = value[key] as? [String: Any] else { throw ClientFailure.invalidResponse }
        return object
    }

    private static func friendlyFailure(_ error: [String: Any]) -> String {
        switch (error["failure"] as? [String: Any])?["category"] as? String {
        case "authentication": "请在电脑上检查 AI 工具的登录状态。"
        case "quota": "AI 工具的额度暂时不足，请稍后再试。"
        case "transport", "machine": "连接中断，请检查网络后重新打开会话。"
        default: "这次工作未完成，请检查电脑上的会话。"
        }
    }

    private static func providerDisplayName(_ id: String?) -> String {
        id == "claude-code" ? "Claude Code" : "Codex"
    }

    private static func providerUnavailableText(_ availability: String, health: [String: Any]?) -> String {
        if health?["state"] as? String == "unavailable" { return "AI 工具暂时不可用，请在电脑上检查。" }
        return switch availability {
        case "not_installed": "尚未安装，请在电脑上处理。"
        case "misconfigured", "unauthenticated": "请先在电脑上登录 AI 工具。"
        case "unsupported_version": "版本不支持，请在电脑上检查。"
        default: "暂时不可用。"
        }
    }

    private static func relativeTime(_ value: String?) -> String {
        guard let value, let date = ISO8601DateFormatter().date(from: value) else { return "" }
        return RelativeDateTimeFormatter().localizedString(for: date, relativeTo: Date())
    }
}

private struct ParsedHistory {
    let messages: [TabletTimelineMessage]
    let turns: [[String: Any]]
    let beforeCursor: String?
    let liveCursor: String
}

private struct JSONResponse {
    let object: [String: Any]?

    init(_ object: [String: Any]) { self.object = object }
    func array(_ key: String) -> [[String: Any]] { object?[key] as? [[String: Any]] ?? [] }
}

private extension JSONResponse {
    func value(_ key: String) -> Any? { object?[key] }
}

private func relativeTime(_ value: String?) -> String {
    guard let value, let date = ISO8601DateFormatter().date(from: value) else { return "" }
    return RelativeDateTimeFormatter().localizedString(for: date, relativeTo: Date())
}
