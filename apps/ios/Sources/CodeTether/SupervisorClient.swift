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
    let diagnostics: [String]
}

struct SupervisorWorkspaceFailure: Error {
    let operation: String
    let underlying: Error
}

enum SupervisorDiagnostic {
    static func message(stage: String, error: Error) -> String {
        let allowedOperations: Set<String> = [
            "host.bootstrap", "machine.list", "machine.get", "project.list",
            "conversation.recent", "attention.list",
        ]
        let workspaceFailure = stage == "workspace" ? error as? SupervisorWorkspaceFailure : nil
        let operation = workspaceFailure.flatMap { allowedOperations.contains($0.operation) ? $0.operation : nil }
        let error = workspaceFailure?.underlying ?? error
        let allowedCodes: Set<String> = [
            "remote_host_unreachable", "host_identity_mismatch", "relay_identity_mismatch",
            "relay_unavailable", "relay_protocol_error", "authorization_revoked", "connection_closed",
            "connection_failed", "timeout", "session_expired", "invalid_response", "invalid_request",
            "operation_not_allowed", "protocol_error", "internal", "tls_unavailable",
        ]
        let code: String
        if let failure = error as? SupervisorWireFailure {
            code = allowedCodes.contains(failure.code) ? failure.code : "other"
        } else if let failure = error as? SupervisorClientError {
            code = allowedCodes.contains(failure.code) ? failure.code : "other"
        } else if let failure = error as? ClientFailure {
            switch failure {
            case .computerUnavailable: code = "computer_unavailable"
            case .computerRemoved: code = "computer_removed"
            case .operationNotAllowed: code = "operation_not_allowed"
            case .invalidResponse: code = "invalid_response"
            case .signInRequired: code = "sign_in_required"
            case .requestFailed: code = "request_failed"
            case .requestRateLimited: code = "rate_limited"
            default: code = "other"
            }
        } else {
            code = "other"
        }
        let label = stage == "workspace" ? "读取工作区失败" : "连接失败"
        if let operation { return "\(label)（\(operation): \(code)）" }
        return "\(label)（\(code)）"
    }
}

struct SupervisorCreateResult {
    let computerID: String
    let target: TabletRoute
}

struct SupervisorClientError: Error, LocalizedError {
    let code: String
    let status: Int?
    let uncertainActionID: String?
    let isExplicitWriteRejection: Bool

    init(code: String, status: Int?, uncertainActionID: String?, isExplicitWriteRejection: Bool = false) {
        self.code = code
        self.status = status
        self.uncertainActionID = uncertainActionID
        self.isExplicitWriteRejection = isExplicitWriteRejection
    }

    var errorDescription: String? {
        if let uncertainActionID { return ClientFailure.actionUncertain(uncertainActionID).localizedDescription }
        if code == "computer_removed" { return ClientFailure.computerRemoved.localizedDescription }
        if code == "authorization_revoked", status == 409 { return ClientFailure.computerRemoved.localizedDescription }
        if code == "operation_not_allowed" { return ClientFailure.operationNotAllowed.localizedDescription }
        if code == "not_found" { return "项目或会话已不存在，请刷新后重试。" }
        if code == "conflict" { return "请求与当前状态冲突，请刷新后重试。" }
        if code == "unsupported" { return ClientFailure.unsupported.localizedDescription }
        if code == "archive_busy" { return ClientFailure.archiveBusy.localizedDescription }
        if code == "sign_in_required" { return ClientFailure.signInRequired.localizedDescription }
        if code == "configuration_missing" { return ClientFailure.configurationMissing.localizedDescription }
        if code == "invalid_response" || code == "invalid_request" { return ClientFailure.invalidResponse.localizedDescription }
        return ClientFailure.computerUnavailable.localizedDescription
    }
}

actor SupervisorClient {
    typealias SessionProvider = @Sendable (PairedComputer, TabletConnectionMode) async throws -> any SupervisorWireSession

    private static let uncertainWriteFailureCodes: Set<String> = [
        "connection_closed", "connection_failed", "timeout", "session_expired",
        "authorization_revoked", "internal", "protocol_error", "invalid_response",
    ]

    private static let explicitWriteRejectionCodes: Set<String> = [
        "invalid_request", "not_found", "conflict", "operation_not_allowed",
    ]

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

    private let account: any TabletAccountService
    private let connector: any SupervisorConnector
    private let sessionProvider: SessionProvider?
    private var active: [String: ActiveConnection] = [:]
    private var conversationTargets: [String: (computerID: String, target: ConversationTarget)] = [:]
    private var projectTargets: [String: ProjectTarget] = [:]
    private var attentionRecords: [String: (computerID: String, record: [String: Any])] = [:]
    private var liveCursors: [String: String] = [:]
    private var conversationHistories: [String: ParsedHistory] = [:]
    private var stateGeneration: UInt64 = 0

    init(
        account: any TabletAccountService,
        connector: any SupervisorConnector,
        sessionProvider: SessionProvider? = nil
    ) {
        self.account = account
        self.connector = connector
        self.sessionProvider = sessionProvider
    }

    func refresh(mode: TabletConnectionMode) async throws -> SupervisorSnapshot {
        let generation = stateGeneration
        let directory = try await account.directory()
        guard generation == stateGeneration else { throw CancellationError() }
        var computers: [TabletComputer] = []
        var attentions: [TabletAttention] = []
        var selectedTransport = ""
        var connected = 0
        var diagnostics: [String] = []

        for computer in directory {
            var stage = "connect"
            do {
                let session = try await ensureConnected(computerID: computer.id, mode: mode, generation: generation)
                stage = "workspace"
                let workspace = try await readWorkspace(
                    computer: computer, session: session, mode: mode, generation: generation
                )
                guard generation == stateGeneration else { throw CancellationError() }
                computers.append(workspace.computer)
                attentions.append(contentsOf: workspace.attentions)
                if selectedTransport.isEmpty { selectedTransport = session.wire.transport }
                connected += 1
            } catch {
                guard generation == stateGeneration else { throw CancellationError() }
                let diagnostic = SupervisorDiagnostic.message(stage: stage, error: error)
                if !diagnostics.contains(diagnostic) { diagnostics.append(diagnostic) }
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
            selectedTransport: selectedTransport, connectedComputerCount: connected,
            diagnostics: diagnostics
        )
    }

    func disconnectAll() async {
        let existing = active.values.map(\.wire)
        active.removeAll()
        for wire in existing { await wire.close() }
    }

    func clearLocalState() async {
        stateGeneration &+= 1
        let existing = active.values.map(\.wire)
        active.removeAll()
        conversationTargets.removeAll()
        projectTargets.removeAll()
        attentionRecords.removeAll()
        liveCursors.removeAll()
        conversationHistories.removeAll()
        for wire in existing { await wire.close() }
    }

    func connectContext(computerID: String, mode: TabletConnectionMode) async throws -> String {
        let session = try await ensureConnected(computerID: computerID, mode: mode)
        return session.wire.transport
    }

    func conversation(computerID: String, conversationID: String, mode: TabletConnectionMode) async throws -> TabletConversationDetail {
        let generation = stateGeneration
        guard let context = conversationTargets[conversationID], context.computerID == computerID else {
            throw ClientFailure.invalidResponse
        }
        let session = try await ensureConnected(computerID: computerID, mode: mode, generation: generation)
        guard generation == stateGeneration else { throw CancellationError() }
        return try await readConversation(session: session, target: context.target, mode: mode, generation: generation)
    }

    func pollConversation(computerID: String, conversationID: String, mode: TabletConnectionMode) async throws -> TabletConversationDetail? {
        let generation = stateGeneration
        guard let context = conversationTargets[conversationID], context.computerID == computerID,
              let cursor = liveCursors[conversationID] else { return nil }
        let session = try await ensureConnected(computerID: computerID, mode: mode, generation: generation)
        guard generation == stateGeneration else { throw CancellationError() }
        let page = try await readSizedPage(computerID: computerID, mode: mode, initialLimit: 16) { limit in
            try await self.request(
                computerID: computerID, mode: mode, operation: "conversation.live.read",
                fields: context.target.fields.merging(["cursor": cursor, "limit": limit, "waitMs": 0]) { _, next in next },
                expectedGeneration: generation
            )
        }
        guard generation == stateGeneration else { throw CancellationError() }
        guard page.object?["conversationId"] as? String == conversationID else { throw ClientFailure.invalidResponse }
        let events = page.array("events")
        if page.object?["resetRequired"] as? Bool == true || !events.isEmpty {
            return try await readConversation(session: session, target: context.target, mode: mode, generation: generation)
        }
        return nil
    }

    func perform(_ action: TabletPendingAction, mode: TabletConnectionMode) async throws -> SupervisorCreateResult? {
        let generation = stateGeneration
        guard !action.input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw ClientFailure.invalidResponse }
        switch action.operation {
        case .createConversation:
            guard let provider = action.provider else { throw ClientFailure.invalidResponse }
            _ = try await ensureConnected(computerID: action.computerID, mode: mode, generation: generation)
            let machine = try await request(
                computerID: action.computerID, mode: mode, operation: "machine.get",
                fields: ["machineId": action.machineID], expectedGeneration: generation
            )
            guard generation == stateGeneration else { throw CancellationError() }
            let providers = machine.object?["providers"] as? [[String: Any]] ?? []
            guard let tool = providers.first(where: { $0["provider"] as? String == provider }),
                  tool["availability"] as? String == "available",
                  ((tool["executionHealth"] as? [String: Any])?["state"] as? String) != "unavailable" else {
                throw ClientFailure.unsupported
            }
            let capabilities = tool["capabilities"] as? [String: Any] ?? [:]
            guard capabilities["providerExecution"] as? Bool == true else { throw ClientFailure.unsupported }
            var fields: [String: Any] = [
                "machineId": action.machineID, "projectId": action.projectID, "provider": provider,
                "input": ["type": "text", "text": action.input],
            ]
            if let reasoning = action.reasoning { fields["reasoning"] = reasoning }
            let result = try await mutate(
                computerID: action.computerID, mode: mode, operation: "conversation.create",
                fields: fields, actionID: action.actionID, expectedGeneration: generation
            )
            guard generation == stateGeneration else { throw CancellationError() }
            do {
                return try registerCreatedConversation(
                    result, computerID: action.computerID, machineID: action.machineID, projectID: action.projectID
                )
            } catch {
                throw SupervisorClientError(code: "invalid_response", status: nil, uncertainActionID: action.actionID)
            }
        case .sendTurn:
            guard let conversationID = action.conversationID else { throw ClientFailure.invalidResponse }
            let target = ConversationTarget(
                machineID: action.machineID, projectID: action.projectID, conversationID: conversationID
            )
            conversationTargets[conversationID] = (action.computerID, target)
            let fields = target.fields.merging(["input": ["type": "text", "text": action.input]]) { _, next in next }
            _ = try await mutate(
                computerID: action.computerID, mode: mode, operation: "conversation.turn.start",
                fields: fields, actionID: action.actionID, expectedGeneration: generation
            )
            guard generation == stateGeneration else { throw CancellationError() }
            return nil
        }
    }

    private func registerCreatedConversation(
        _ result: JSONResponse,
        computerID: String,
        machineID: String,
        projectID: String
    ) throws -> SupervisorCreateResult {
        guard let data = result.object?["data"] as? [String: Any],
              let conversation = data["conversation"] as? [String: Any],
              let target = try? Self.parseTarget(conversation),
              target.projectID == projectID, target.machineID == machineID else {
            throw ClientFailure.invalidResponse
        }
        conversationTargets[target.conversationID] = (computerID, target)
        return SupervisorCreateResult(
            computerID: computerID,
            target: .conversation(computerID: computerID, conversationID: target.conversationID)
        )
    }

    func approve(attentionID: String, accepted: Bool, mode: TabletConnectionMode) async throws {
        let generation = stateGeneration
        guard let (computerID, cached) = attentionRecords[attentionID] else { throw ClientFailure.invalidResponse }
        let approvalID: String
        if let payload = cached["payload"] as? [String: Any], let value = payload["approvalId"] as? String {
            approvalID = value
        } else { throw ClientFailure.invalidResponse }
        let actionID = Self.newActionID()
        _ = try await mutate(
            computerID: computerID, mode: mode, operation: "approval.resolve",
            fields: ["approvalId": approvalID, "decision": accepted ? "accept" : "decline"], actionID: actionID,
            expectedGeneration: generation
        )
    }

    func resolveAttention(attentionID: String, mode: TabletConnectionMode) async throws {
        let generation = stateGeneration
        guard let (computerID, cached) = attentionRecords[attentionID],
              ["completed_review", "failed"].contains(cached["type"] as? String ?? "") else {
            throw ClientFailure.unsupported
        }
        let actionID = Self.newActionID()
        _ = try await mutate(
            computerID: computerID, mode: mode, operation: "attention.resolve",
            fields: ["attentionId": attentionID], actionID: actionID, expectedGeneration: generation
        )
    }

    func interrupt(computerID: String, conversationID: String, turnID: String, mode: TabletConnectionMode) async throws {
        let generation = stateGeneration
        guard let context = conversationTargets[conversationID], context.computerID == computerID else {
            throw ClientFailure.invalidResponse
        }
        let session = try await ensureConnected(computerID: computerID, mode: mode, generation: generation)
        let detail = try await readConversation(session: session, target: context.target, mode: mode, generation: generation)
        guard detail.canInterrupt else { throw ClientFailure.unsupported }
        let actionID = Self.newActionID()
        _ = try await mutate(
            computerID: computerID, mode: mode, operation: "turn.interrupt",
            fields: context.target.fields.merging(["turnId": turnID]) { _, next in next }, actionID: actionID,
            expectedGeneration: generation
        )
    }

    func archive(computerID: String, conversationID: String, mode: TabletConnectionMode) async throws {
        let generation = stateGeneration
        guard let context = conversationTargets[conversationID], context.computerID == computerID else {
            throw ClientFailure.invalidResponse
        }
        let actionID = Self.newActionID()
        do {
            _ = try await mutate(
                computerID: computerID, mode: mode, operation: "conversation.archive",
                fields: context.target.fields, actionID: actionID, expectedGeneration: generation
            )
        } catch let failure as SupervisorClientError where failure.status == 409 || failure.code == "conflict" {
            throw ClientFailure.archiveBusy
        }
    }

    func changes(computerID: String, conversationID: String, mode: TabletConnectionMode) async throws -> [TabletDiffFile] {
        let generation = stateGeneration
        guard let context = conversationTargets[conversationID], context.computerID == computerID else {
            throw ClientFailure.invalidResponse
        }
        let session = try await ensureConnected(computerID: computerID, mode: mode, generation: generation)
        let detail = try await readConversation(session: session, target: context.target, mode: mode, generation: generation)
        guard detail.canViewChanges else { throw ClientFailure.unsupported }
        var all: [[String: Any]] = []
        var offset = 0
        while true {
            let page = try await request(
                computerID: computerID, mode: mode, operation: "conversation.changes",
                fields: context.target.fields.merging(["offset": offset]) { _, next in next },
                expectedGeneration: generation
            )
            guard page.object?["conversationId"] as? String == conversationID else { throw ClientFailure.invalidResponse }
            all.append(contentsOf: page.array("changes"))
            guard let next = page.object?["nextOffset"] as? Int else { break }
            guard next > offset, next <= 2_048, all.count <= 2_048 else { throw ClientFailure.invalidResponse }
            offset = next
        }
        return try all.enumerated().map { index, change in
            var identified = change
            identified["_recordIndex"] = index
            return try Self.parseDiffFile(identified)
        }
    }

    func olderHistory(computerID: String, conversationID: String, cursor: String, mode: TabletConnectionMode) async throws -> (messages: [TabletTimelineMessage], beforeCursor: String?) {
        let generation = stateGeneration
        guard let context = conversationTargets[conversationID], context.computerID == computerID else {
            throw ClientFailure.invalidResponse
        }
        let page = try await readSizedPage(computerID: computerID, mode: mode, initialLimit: 8) { limit in
            try await self.request(
                computerID: computerID, mode: mode, operation: "conversation.history",
                fields: context.target.fields.merging(["limit": limit, "cursor": cursor]) { _, next in next },
                expectedGeneration: generation
            )
        }
        guard generation == stateGeneration else { throw CancellationError() }
        let parsed = try Self.parseHistory(page.object ?? [:], target: context.target)
        let merged = Self.mergeHistory(
            loaded: conversationHistories[conversationID], incoming: parsed, olderPage: true
        )
        conversationHistories[conversationID] = merged
        return (merged.messages, merged.beforeCursor)
    }

    private func ensureConnected(
        computerID: String,
        mode: TabletConnectionMode,
        force: Bool = false,
        generation expectedGeneration: UInt64? = nil
    ) async throws -> ActiveConnection {
        let generation = expectedGeneration ?? stateGeneration
        guard generation == stateGeneration else { throw CancellationError() }
        if !force, let current = active[computerID], current.control,
           (mode == .automatic || current.mode == mode),
           let expiry = TabletTimestamp.parse(current.wire.expiresAt), expiry > Date().addingTimeInterval(3) {
            return current
        }
        if let old = active.removeValue(forKey: computerID) { await old.wire.close() }
        do {
            let result = try await connect(computerID: computerID, mode: mode)
            guard generation == stateGeneration else {
                await result.wire.close()
                throw CancellationError()
            }
            active[computerID] = result
            return result
        } catch let failure as SupervisorWireFailure where failure.code == "authorization_revoked" {
            guard generation == stateGeneration else { throw CancellationError() }
            let result = try await connect(computerID: computerID, mode: mode)
            guard generation == stateGeneration else {
                await result.wire.close()
                throw CancellationError()
            }
            active[computerID] = result
            return result
        }
    }

    private func connect(computerID: String, mode: TabletConnectionMode) async throws -> ActiveConnection {
        let computer: PairedComputer
        let wire: any SupervisorWireSession
        if let sessionProvider {
            guard let value = try await account.directory().first(where: { $0.id == computerID }) else {
                throw ClientFailure.computerRemoved
            }
            computer = value
            wire = try await sessionProvider(value, mode)
        } else {
            let context = try await account.connectContext(computerID: computerID, mode: mode)
            computer = context.computer
            wire = try await connector.connect(context, mode: mode)
        }
        guard wire.control else {
            await wire.close()
            throw ClientFailure.operationNotAllowed
        }
        return ActiveConnection(wire: wire, computer: computer, control: wire.control, mode: mode)
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
        actionID: String? = nil,
        expectedGeneration: UInt64? = nil
    ) async throws -> JSONResponse {
        let generation = expectedGeneration ?? stateGeneration
        guard generation == stateGeneration else { throw CancellationError() }
        let connection = try await ensureConnected(computerID: computerID, mode: mode, generation: generation)
        guard generation == stateGeneration else { throw CancellationError() }
        let requestObject = fields.merging(["operation": operation]) { current, _ in current }
        let bytes: Data
        do { bytes = try JSONSerialization.data(withJSONObject: requestObject, options: [.sortedKeys]) }
        catch { throw ClientFailure.invalidResponse }
        guard let text = String(data: bytes, encoding: .utf8) else { throw ClientFailure.invalidResponse }
        var enteredWire = false
        do {
            enteredWire = true
            let output = try await connection.wire.request(text)
            guard generation == stateGeneration else { throw CancellationError() }
            guard let data = output.data(using: .utf8),
                  let value = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  value.isEmpty == false else {
                if let actionID {
                    throw SupervisorClientError(code: "invalid_response", status: nil, uncertainActionID: actionID)
                }
                throw ClientFailure.invalidResponse
            }
            return JSONResponse(value)
        } catch let failure as SupervisorWireFailure {
            guard generation == stateGeneration else { throw CancellationError() }
            if actionID != nil {
                let uncertain = Self.uncertainWriteFailureCodes.contains(failure.code)
                if uncertain && ["connection_closed", "connection_failed", "timeout", "session_expired", "authorization_revoked"].contains(failure.code) {
                    await close(computerID: computerID)
                }
                throw SupervisorClientError(
                    code: failure.code, status: failure.status, uncertainActionID: uncertain ? actionID : nil,
                    isExplicitWriteRejection: !uncertain && Self.explicitWriteRejectionCodes.contains(failure.code)
                )
            }
            let reconnectable: Set<String> = ["connection_closed", "connection_failed", "session_expired", "authorization_revoked", "remote_host_unreachable", "timeout"]
            guard retryRead, reconnectable.contains(failure.code) else {
                throw SupervisorClientError(code: failure.code, status: failure.status, uncertainActionID: nil)
            }
            await close(computerID: computerID)
            _ = try await ensureConnected(computerID: computerID, mode: mode, force: true)
            return try await request(
                computerID: computerID, mode: mode, operation: operation, fields: fields,
                retryRead: false, actionID: nil, expectedGeneration: generation
            )
        } catch let failure as SupervisorClientError {
            throw failure
        } catch {
            guard generation == stateGeneration else { throw CancellationError() }
            if let actionID, enteredWire {
                await close(computerID: computerID)
                throw SupervisorClientError(code: "invalid_response", status: nil, uncertainActionID: actionID)
            }
            throw error
        }
    }

    private func mutate(
        computerID: String,
        mode: TabletConnectionMode,
        operation: String,
        fields: [String: Any],
        actionID: String,
        expectedGeneration: UInt64? = nil
    ) async throws -> JSONResponse {
        let response = try await request(
            computerID: computerID, mode: mode, operation: operation,
            fields: Self.mutationFields(fields, actionID: actionID),
            retryRead: false, actionID: actionID, expectedGeneration: expectedGeneration
        )
        guard response.object?["actionId"] as? String == actionID else {
            throw SupervisorClientError(code: "invalid_response", status: nil, uncertainActionID: actionID)
        }
        switch response.object?["status"] as? String {
        case "accepted", "completed": return response
        case "rejected": throw SupervisorClientError(
            code: "operation_not_allowed", status: nil, uncertainActionID: nil, isExplicitWriteRejection: true
        )
        default: throw SupervisorClientError(code: "invalid_response", status: nil, uncertainActionID: actionID)
        }
    }

    static func mutationFields(_ fields: [String: Any], actionID: String) -> [String: Any] {
        fields.merging(["actionId": actionID]) { _, next in next }
    }

    static func isExplicitWriteRejection(_ error: Error) -> Bool {
        (error as? SupervisorClientError)?.isExplicitWriteRejection == true
    }

    static func isDefiniteWriteFailure(_ error: Error) -> Bool {
        if let failure = error as? SupervisorClientError {
            return failure.uncertainActionID == nil && failure.isExplicitWriteRejection
        }
        guard let failure = error as? ClientFailure else { return false }
        switch failure {
        case .invalidResponse, .operationNotAllowed, .unsupported: return true
        default: return false
        }
    }

    private func readWorkspace(
        computer: PairedComputer,
        session: ActiveConnection,
        mode: TabletConnectionMode,
        generation: UInt64
    ) async throws -> (computer: TabletComputer, attentions: [TabletAttention]) {
        var operation = "host.bootstrap"
        do {
            _ = try await request(computerID: computer.id, mode: mode, operation: "host.bootstrap", expectedGeneration: generation)
            guard generation == stateGeneration else { throw CancellationError() }
            operation = "machine.list"
            let machinePage = try await request(computerID: computer.id, mode: mode, operation: "machine.list", expectedGeneration: generation)
            guard generation == stateGeneration else { throw CancellationError() }
            let machineRows = machinePage.array("machines")
            guard machineRows.count <= 128 else { throw ClientFailure.invalidResponse }
            var machines: [TabletMachine] = []
            var projectsForAttention: [String: TabletProject] = [:]

            for row in machineRows {
                operation = "machine.list"
                let machineID = try Self.requiredString(row, "machineId", max: 160)
                operation = "machine.get"
                let detailPage = try await request(
                    computerID: computer.id, mode: mode, operation: "machine.get",
                    fields: ["machineId": machineID], expectedGeneration: generation
                )
                guard generation == stateGeneration else { throw CancellationError() }
                let detail = try Self.object(detailPage.object, "machine")
                guard detail["machineId"] as? String == machineID else { throw ClientFailure.invalidResponse }
                let machineAvailable = row["availability"] as? String == "available"
                let machineCapabilities = row["capabilities"] as? [String: Any] ?? [:]
                let canExecute = machineAvailable && machineCapabilities["providerExecution"] as? Bool == true
                let providerRows = detailPage.array("providers")
                let providers = try providerRows.map { try Self.parseProvider($0, canExecute: canExecute) }

                operation = "project.list"
                let projectRows = try await readPages(
                    computerID: computer.id, mode: mode, operation: "project.list", listKey: "projects",
                    fields: ["machineId": machineID], generation: generation
                )
                guard generation == stateGeneration else { throw CancellationError() }
                let projectAccess = machineAvailable && machineCapabilities["projectAccess"] as? Bool == true
                var projects = try projectRows.map { try Self.parseProject($0, machineID: machineID, available: projectAccess) }
                for project in projects { projectTargets[project.id] = ProjectTarget(computerID: computer.id, machineID: machineID, projectID: project.id) }

                operation = "conversation.recent"
                let recentPage = try await request(
                    computerID: computer.id, mode: mode, operation: "conversation.recent",
                    fields: ["machineId": machineID, "limit": 30], expectedGeneration: generation
                )
                guard generation == stateGeneration else { throw CancellationError() }
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

            operation = "attention.list"
            let attentionPage = try await request(
                computerID: computer.id, mode: mode, operation: "attention.list",
                fields: ["status": "open", "limit": 50], expectedGeneration: generation
            )
            guard generation == stateGeneration else { throw CancellationError() }
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
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            throw SupervisorWorkspaceFailure(operation: operation, underlying: error)
        }
    }

    private func readConversation(
        session: ActiveConnection,
        target: ConversationTarget,
        mode: TabletConnectionMode,
        generation: UInt64
    ) async throws -> TabletConversationDetail {
        let historyPage = try await readSizedPage(computerID: session.computer.id, mode: mode, initialLimit: 8) { limit in
            try await self.request(computerID: session.computer.id, mode: mode, operation: "conversation.history",
                                   fields: target.fields.merging(["limit": limit]) { _, next in next },
                                   expectedGeneration: generation)
        }
        guard generation == stateGeneration else { throw CancellationError() }
        let summaryPage = try await request(
            computerID: session.computer.id, mode: mode, operation: "conversation.get", fields: target.fields,
            expectedGeneration: generation
        )
        guard generation == stateGeneration else { throw CancellationError() }
        let conversationObject = try Self.object(summaryPage.object, "conversation")
        guard try Self.parseTarget(conversationObject) == target else { throw ClientFailure.invalidResponse }
        let machinePage = try await request(
            computerID: session.computer.id, mode: mode, operation: "machine.get",
            fields: ["machineId": target.machineID], expectedGeneration: generation
        )
        guard generation == stateGeneration else { throw CancellationError() }
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
        let pageHistory = try Self.parseHistory(historyPage.object ?? [:], target: target)
        let history = try await Self.reconcileHistory(
            loaded: conversationHistories[target.conversationID], latest: pageHistory
        ) { cursor in
            let page = try await self.readSizedPage(computerID: session.computer.id, mode: mode, initialLimit: 8) { limit in
                try await self.request(
                    computerID: session.computer.id, mode: mode, operation: "conversation.history",
                    fields: target.fields.merging(["limit": limit, "cursor": cursor]) { _, next in next },
                    expectedGeneration: generation
                )
            }
            return try Self.parseHistory(page.object ?? [:], target: target)
        }
        guard generation == stateGeneration else { throw CancellationError() }
        conversationHistories[target.conversationID] = history
        liveCursors[target.conversationID] = history.liveCursor

        let attentionPage = try await request(computerID: session.computer.id, mode: mode, operation: "attention.list",
                                              fields: ["status": "open", "limit": 50, "projectId": target.projectID],
                                              expectedGeneration: generation)
        guard generation == stateGeneration else { throw CancellationError() }
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

    private func readPages(
        computerID: String,
        mode: TabletConnectionMode,
        operation: String,
        listKey: String,
        fields: [String: Any],
        generation: UInt64
    ) async throws -> [[String: Any]] {
        var result: [[String: Any]] = []
        var seen = Set<String>()
        var cursor: String?
        for _ in 0..<128 {
            var requestFields = fields.merging(["limit": 50]) { _, next in next }
            if let cursor { requestFields["cursor"] = cursor }
            let page = try await request(
                computerID: computerID, mode: mode, operation: operation,
                fields: requestFields, expectedGeneration: generation
            )
            guard generation == stateGeneration else { throw CancellationError() }
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
            return ParsedHistory(messages: messages, turns: [], beforeCursor: before, liveCursor: live, complete: complete)
        case "durable":
            guard let runtime = row["runtime"] as? [String: Any], runtime["conversationId"] as? String == target.conversationID else {
                throw ClientFailure.invalidResponse
            }
            let turns = runtime["turns"] as? [[String: Any]] ?? []
            var messages: [(Int, TabletTimelineMessage)] = []
            let orderedTurns = turns.enumerated().sorted { lhs, rhs in
                let left = lhs.element["startedAt"] as? String ?? ""
                let right = rhs.element["startedAt"] as? String ?? ""
                return left == right ? lhs.offset < rhs.offset : left < right
            }.map(\.element)
            for turn in orderedTurns {
                guard turn["conversationId"] as? String == target.conversationID,
                      let turnID = turn["turnId"] as? String else { throw ClientFailure.invalidResponse }
                var round: [(order: Int, index: Int, message: TabletTimelineMessage)] = []
                if let input = turn["input"] as? [String: Any], let text = input["text"] as? String {
                    round.append((Int.min, -1, TabletTimelineMessage(id: "input:\(turnID)", kind: .user, text: text, timestamp: turn["startedAt"] as? String ?? "")))
                }
                let turnMessages = (runtime["messages"] as? [[String: Any]] ?? []).filter { $0["turnId"] as? String == turnID }
                let turnTools = (runtime["tools"] as? [[String: Any]] ?? []).filter { $0["turnId"] as? String == turnID }
                for (index, message) in turnMessages.enumerated() {
                    round.append((message["order"] as? Int ?? 0, index, TabletTimelineMessage(
                        id: try requiredString(message, "itemId", max: 200), kind: .assistant,
                        text: message["text"] as? String ?? "", timestamp: message["timestamp"] as? String ?? ""
                    )))
                }
                for (index, tool) in turnTools.enumerated() {
                    let content = tool["summary"] as? String ?? tool["outputSummary"] as? String ?? tool["name"] as? String ?? "工具活动"
                    round.append((tool["order"] as? Int ?? 0, turnMessages.count + index, TabletTimelineMessage(
                        id: try requiredString(tool, "itemId", max: 200), kind: .activity,
                        text: content, timestamp: tool["startedAt"] as? String ?? ""
                    )))
                }
                round.sort { lhs, rhs in lhs.order == rhs.order ? lhs.index < rhs.index : lhs.order < rhs.order }
                messages.append(contentsOf: round.map { (Int($0.order), $0.message) })
                if let final = turn["finalMessage"] as? String, !final.isEmpty, turnMessages.isEmpty {
                    messages.append((Int.max, TabletTimelineMessage(
                        id: "final:\(turnID)", kind: .assistant, text: final,
                        timestamp: turn["completedAt"] as? String ?? turn["startedAt"] as? String ?? ""
                    )))
                }
            }
            return ParsedHistory(messages: messages.map(\.1), turns: orderedTurns, beforeCursor: before, liveCursor: live, complete: complete)
        default: throw ClientFailure.invalidResponse
        }
    }

    static func parseHistoryForTesting(_ row: [String: Any], conversationID: String) throws -> [TabletTimelineMessage] {
        let target = ConversationTarget(machineID: "machine_test", projectID: "project_test", conversationID: conversationID)
        return try parseHistory(row, target: target).messages
    }

    static func parseHistoryRecordForTesting(_ row: [String: Any], conversationID: String) throws -> ParsedHistory {
        let target = ConversationTarget(machineID: "machine_test", projectID: "project_test", conversationID: conversationID)
        return try parseHistory(row, target: target)
    }

    static func historiesOverlap(_ lhs: ParsedHistory, _ rhs: ParsedHistory) -> Bool {
        let leftIDs = Set(lhs.messages.map(\.id))
        if rhs.messages.contains(where: { leftIDs.contains($0.id) }) { return true }
        let leftTurns = Set(lhs.turns.compactMap { $0["turnId"] as? String })
        return rhs.turns.contains { turn in
            guard let id = turn["turnId"] as? String else { return false }
            return leftTurns.contains(id)
        }
    }

    static func reconcileHistory(
        loaded: ParsedHistory?,
        latest: ParsedHistory,
        loadBefore: (String) async throws -> ParsedHistory
    ) async throws -> ParsedHistory {
        guard let loaded, !loaded.isEmpty, !latest.isEmpty else {
            return mergeHistory(loaded: loaded, incoming: latest)
        }
        var refreshed = latest
        var seenCursors = Set<String>()
        for _ in 0..<128 {
            if historiesOverlap(loaded, refreshed) { break }
            guard let cursor = refreshed.beforeCursor, seenCursors.insert(cursor).inserted else { return latest }
            let older = try await loadBefore(cursor)
            refreshed = mergeHistory(loaded: refreshed, incoming: older, olderPage: true)
            if older.isEmpty { return latest }
        }
        guard historiesOverlap(loaded, refreshed) else { return latest }
        return mergeHistory(loaded: loaded, incoming: refreshed)
    }

    static func mergeHistory(loaded: ParsedHistory?, incoming: ParsedHistory, olderPage: Bool = false) -> ParsedHistory {
        guard let loaded, !loaded.isEmpty else { return incoming }
        let incomingStartsEarlier: Bool
        if olderPage {
            incomingStartsEarlier = true
        } else {
            switch (loaded.firstRecord(), incoming.firstRecord()) {
            case let (left?, right?):
                if left == right { incomingStartsEarlier = false }
                else if loaded.containsRecord(right) { incomingStartsEarlier = false }
                else if incoming.containsRecord(left) { incomingStartsEarlier = true }
                else { incomingStartsEarlier = right.timestamp < left.timestamp }
            case (_?, nil): incomingStartsEarlier = false
            default: incomingStartsEarlier = true
            }
        }
        var messages: [TabletTimelineMessage] = []
        var messageIndexes: [String: Int] = [:]
        let firstMessages = incomingStartsEarlier ? incoming.messages : loaded.messages
        let secondMessages = incomingStartsEarlier ? loaded.messages : incoming.messages
        for batch in [firstMessages, secondMessages] {
            for message in batch where messageIndexes[message.id] == nil {
                messageIndexes[message.id] = messages.count
                messages.append(message)
            }
        }
        if !olderPage {
            for message in incoming.messages {
                if let index = messageIndexes[message.id] { messages[index] = message }
            }
        }

        var turns: [[String: Any]] = []
        var turnIndexes: [String: Int] = [:]
        let firstTurns = incomingStartsEarlier ? incoming.turns : loaded.turns
        let secondTurns = incomingStartsEarlier ? loaded.turns : incoming.turns
        for batch in [firstTurns, secondTurns] {
            for turn in batch {
                guard let id = turn["turnId"] as? String, turnIndexes[id] == nil else { continue }
                turnIndexes[id] = turns.count
                turns.append(turn)
            }
        }
        if !olderPage {
            for turn in incoming.turns {
                guard let id = turn["turnId"] as? String, let index = turnIndexes[id] else { continue }
                turns[index] = turn
            }
        }

        let earliest = olderPage || incomingStartsEarlier ? incoming : loaded
        return ParsedHistory(
            messages: messages,
            turns: turns,
            beforeCursor: olderPage
                ? incoming.beforeCursor
                : (earliest.complete ? nil : earliest.beforeCursor),
            liveCursor: olderPage ? loaded.liveCursor : incoming.liveCursor,
            complete: earliest.complete
        )
    }

    static func parseDiffFile(_ row: [String: Any]) throws -> TabletDiffFile {
        let turnID = try requiredString(row, "turnId", max: 160)
        let itemID = row["itemId"] as? String ?? "no-item"
        guard !itemID.isEmpty, itemID.utf8.count <= 200 else { throw ClientFailure.invalidResponse }
        let path = try requiredString(row, "path", max: 4_096)
        let rowIndex = row["_recordIndex"] as? Int
        let diff = row["diff"] as? String ?? ""
        let additions = row["additions"] as? Int ?? 0
        let deletions = row["deletions"] as? Int ?? 0
        let lines = parseUnifiedDiff(diff)
        let identity = "\(turnID):\(itemID):\(path)" + (itemID == "no-item" ? ":\(rowIndex ?? 0)" : "")
        return TabletDiffFile(id: identity, path: path, additions: additions, deletions: deletions, lines: lines)
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
        guard let value, let date = TabletTimestamp.parse(value) else { return "" }
        return RelativeDateTimeFormatter().localizedString(for: date, relativeTo: Date())
    }
}

struct ParsedHistory {
    let messages: [TabletTimelineMessage]
    let turns: [[String: Any]]
    let beforeCursor: String?
    let liveCursor: String
    let complete: Bool

    var isEmpty: Bool { messages.isEmpty && turns.isEmpty }
}

private struct HistoryRecord: Equatable {
    let id: String
    let isTurn: Bool
    let timestamp: String
}

private extension ParsedHistory {
    func firstRecord() -> HistoryRecord? {
        if let firstMessage = messages.first, !firstMessage.id.hasPrefix("input:") {
            return HistoryRecord(id: firstMessage.id, isTurn: false, timestamp: firstMessage.timestamp)
        }
        if let turn = turns.first, let id = turn["turnId"] as? String {
            return HistoryRecord(id: id, isTurn: true, timestamp: turn["startedAt"] as? String ?? "")
        }
        guard let firstMessage = messages.first else { return nil }
        return HistoryRecord(id: firstMessage.id, isTurn: false, timestamp: firstMessage.timestamp)
    }

    func containsRecord(_ record: HistoryRecord) -> Bool {
        if record.isTurn { return turns.contains { $0["turnId"] as? String == record.id } }
        return messages.contains { $0.id == record.id }
    }
}

struct JSONResponse {
    let object: [String: Any]?

    init(_ object: [String: Any]) { self.object = object }
    func array(_ key: String) -> [[String: Any]] { object?[key] as? [[String: Any]] ?? [] }
}

private extension JSONResponse {
    func value(_ key: String) -> Any? { object?[key] }
}

private func relativeTime(_ value: String?) -> String {
    guard let value, let date = TabletTimestamp.parse(value) else { return "" }
    return RelativeDateTimeFormatter().localizedString(for: date, relativeTo: Date())
}
