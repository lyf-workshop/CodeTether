#if DEBUG
import Foundation

enum UITestPendingCreateFixture {
    static let account = AccountProfile(id: "account_ui_test", email: "ui-test@example.invalid")
    static let computerID = "computer_ui_test"
    static let machineID = "machine_ui_test"
    static let projectID = "project_ui_test"
    static let conversationID = "conversation_ui_test"

    static let computer = PairedComputer(
        id: computerID, name: "测试电脑", platform: "iPadOS Simulator", canControl: true,
        isAvailable: true, expiresAt: "2099-01-01T00:00:00Z", authorizationID: "authorization_ui_test",
        hostFingerprint: "fingerprint_ui_test", identityGeneration: 1, hostPublicJWKJSON: "{}",
        grantJSON: nil, descriptorJSON: nil, lastUsedAt: nil
    )

    static let pendingAction = TabletPendingAction(
        accountID: account.id, actionID: "act_ui_test_pending_create", operation: .createConversation,
        computerID: computerID, machineID: machineID, projectID: projectID, conversationID: nil,
        provider: "codex", reasoning: nil, input: "保留这句原始请求"
    )

    static let computers: [TabletComputer] = {
        let provider = TabletProvider(
            id: "codex", name: "Codex", status: "available", canStart: true,
            canApprove: false, canInterrupt: false, canViewChanges: false,
            reasoningOptions: [], unavailableReason: nil
        )
        let project = TabletProject(
            id: projectID, computerID: computerID, machineID: machineID,
            name: "验收测试项目", available: true, sessions: []
        )
        let machine = TabletMachine(
            id: machineID, name: "验收测试设备", platform: "iPadOS Simulator", status: "online",
            isLocal: false, projects: [project], recent: [], providers: [provider]
        )
        return [TabletComputer(
            id: computerID, name: "测试电脑", platform: "iPadOS Simulator", lastUsed: "刚刚",
            available: true, canControl: true, authorizationExpiresAt: computer.expiresAt, machines: [machine]
        )]
    }()
}

actor UITestPendingCreateAccount: TabletAccountService {
    func restore() async throws -> AccountProfile? { UITestPendingCreateFixture.account }
    func requestSignInCode(email: String) async throws { }
    func verifySignInCode(email: String, code: String) async throws -> AccountProfile {
        UITestPendingCreateFixture.account
    }
    func signOut() async { }
    func directory() async throws -> [PairedComputer] { [UITestPendingCreateFixture.computer] }
    func connectContext(computerID: String, mode: TabletConnectionMode) async throws -> SupervisorConnectContext {
        throw ClientFailure.computerUnavailable
    }
    func pair(code: String, onClaimed: @Sendable () -> Void) async throws -> PairedComputer {
        throw ClientFailure.computerUnavailable
    }
    func remove(computerID: String) async throws { }
}

actor UITestPendingCreateWire: SupervisorWireSession {
    nonisolated let transport = "relay"
    nonisolated let control = true
    nonisolated let expiresAt = "2099-01-01T00:00:00Z"

    func request(_ json: String) async throws -> String {
        guard let object = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any],
              let operation = object["operation"] as? String else {
            throw SupervisorWireFailure(code: "invalid_request", status: 400)
        }
        switch operation {
        case "host.bootstrap":
            return Self.response([:])
        case "machine.list":
            return Self.response(["machines": [[
                "machineId": UITestPendingCreateFixture.machineID,
                "availability": "available", "connectionState": "online", "isLocal": false,
                "capabilities": ["projectAccess": true, "providerExecution": true]
            ]]])
        case "machine.get":
            return Self.response([
                "machine": [
                    "machineId": UITestPendingCreateFixture.machineID, "displayName": "验收测试设备",
                    "platform": "iPadOS", "architecture": "arm64"
                ],
                "providers": [[
                    "provider": "codex", "displayName": "Codex", "availability": "available",
                    "capabilities": ["providerExecution": true], "executionHealth": ["state": "healthy"]
                ]]
            ])
        case "project.list":
            return Self.response(["projects": [[
                "projectId": UITestPendingCreateFixture.projectID,
                "machineId": UITestPendingCreateFixture.machineID, "name": "验收测试项目"
            ]], "hasMore": false])
        case "conversation.recent":
            return Self.response(["conversations": []])
        case "attention.list":
            return Self.response(["items": []])
        case "conversation.create":
            guard let actionID = object["actionId"] as? String else {
                throw SupervisorWireFailure(code: "invalid_request", status: 400)
            }
            return Self.response([
                "actionId": actionID, "status": "accepted", "data": ["conversation": Self.conversation]
            ])
        case "conversation.get":
            return Self.response(["conversation": Self.conversation])
        case "conversation.history":
            return Self.response([
                "conversationId": UITestPendingCreateFixture.conversationID,
                "hasMoreBefore": false, "historyComplete": true, "liveCursor": "ui-test-live",
                "source": "durable", "runtime": [
                    "conversationId": UITestPendingCreateFixture.conversationID,
                    "turns": [], "messages": [], "tools": []
                ]
            ])
        default:
            return Self.response([:])
        }
    }

    func close() async { }

    private static var conversation: [String: Any] {
        [
            "conversationId": UITestPendingCreateFixture.conversationID,
            "machineId": UITestPendingCreateFixture.machineID,
            "projectId": UITestPendingCreateFixture.projectID,
            "provider": "codex", "title": "保留这句原始请求", "status": "idle",
            "lastActivityAt": "2026-01-01T00:00:00Z", "archived": false
        ]
    }

    private static func response(_ value: [String: Any]) -> String {
        String(decoding: try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]), as: UTF8.self)
    }
}
#endif
