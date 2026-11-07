import CryptoKit
import XCTest
@testable import CodeTether

final class SupervisorInteropTests: XCTestCase {
    func testConnectionDiagnosticsDistinguishStagesAndNeverExposeUnknownErrorText() {
        let transport = SupervisorDiagnostic.message(
            stage: "connect", error: SupervisorWireFailure(code: "remote_host_unreachable", status: nil)
        )
        let workspace = SupervisorDiagnostic.message(stage: "workspace", error: ClientFailure.invalidResponse)
        let unknown = SupervisorDiagnostic.message(
            stage: "workspace", error: SupervisorWireFailure(code: "sensitive-untrusted-value", status: nil)
        )
        XCTAssertEqual(transport, "连接失败（remote_host_unreachable）")
        XCTAssertEqual(workspace, "读取工作区失败（invalid_response）")
        XCTAssertEqual(unknown, "读取工作区失败（other）")
    }

    func testWorkspaceDiagnosticIncludesOnlyAllowedOperationAndErrorCode() {
        let failure = SupervisorWorkspaceFailure(
            operation: "machine.get", underlying: SupervisorWireFailure(code: "internal", status: nil)
        )
        XCTAssertEqual(SupervisorDiagnostic.message(stage: "workspace", error: failure),
                       "读取工作区失败（machine.get: internal）")

        let untrusted = SupervisorWorkspaceFailure(
            operation: "private-path-or-id", underlying: SupervisorWireFailure(code: "private-error", status: nil)
        )
        XCTAssertEqual(SupervisorDiagnostic.message(stage: "workspace", error: untrusted),
                       "读取工作区失败（other）")
        XCTAssertEqual(SupervisorDiagnostic.message(stage: "connect", error: failure), "连接失败（other）")
    }

    func testDurableHistoryKeepsEachQuestionBeforeItsAnswer() throws {
        let row: [String: Any] = [
            "conversationId": "conv_test", "hasMoreBefore": false, "historyComplete": true,
            "liveCursor": "live_1", "source": "durable",
            "runtime": [
                "conversationId": "conv_test",
                "turns": [
                    ["conversationId": "conv_test", "turnId": "turn_1", "startedAt": "2026-01-01T00:00:00Z", "input": ["text": "问一"], "finalMessage": "答一"],
                    ["conversationId": "conv_test", "turnId": "turn_2", "startedAt": "2026-01-01T00:00:01Z", "input": ["text": "问二"], "finalMessage": "答二"],
                    ["conversationId": "conv_test", "turnId": "turn_3", "startedAt": "2026-01-01T00:00:02Z", "input": ["text": "问三"], "finalMessage": "答三"],
                ],
                "messages": [], "tools": [],
            ],
        ]
        let messages = try SupervisorClient.parseHistoryForTesting(row, conversationID: "conv_test")
        XCTAssertEqual(messages.map(\.text), ["问一", "答一", "问二", "答二", "问三", "答三"])
        XCTAssertEqual(messages.prefix(6).enumerated().filter { $0.offset.isMultiple(of: 2) }.count, 3)
    }

    func testDuplicatePathChangesUseTurnAndItemIdentity() throws {
        let first = try SupervisorClient.parseDiffFile(["turnId": "turn_1", "itemId": "item_1", "path": "Sources/App.swift"])
        let sameTurnDifferentItem = try SupervisorClient.parseDiffFile(["turnId": "turn_1", "itemId": "item_2", "path": "Sources/App.swift"])
        let sameItemDifferentTurn = try SupervisorClient.parseDiffFile(["turnId": "turn_2", "itemId": "item_1", "path": "Sources/App.swift"])
        XCTAssertEqual(Set([first.id, sameTurnDifferentItem.id, sameItemDifferentTurn.id]).count, 3)
        XCTAssertEqual(first.path, sameTurnDifferentItem.path)
    }

    func testHistoryMergePreservesOlderLoadedRoundsWhenLiveWindowAdvances() throws {
        let target = ["conversationId": "conv_test", "hasMoreBefore": true, "beforeCursor": "older_1", "liveCursor": "c1", "source": "durable", "runtime": ["conversationId": "conv_test", "turns": [["conversationId": "conv_test", "turnId": "turn_1", "startedAt": "2026-01-01T00:00:00Z", "input": ["text": "旧问"], "finalMessage": "旧答"]], "messages": [], "tools": []]] as [String: Any]
        let newer = ["conversationId": "conv_test", "hasMoreBefore": true, "beforeCursor": "before_1", "liveCursor": "c2", "source": "durable", "runtime": ["conversationId": "conv_test", "turns": [["conversationId": "conv_test", "turnId": "turn_2", "startedAt": "2026-01-01T00:00:01Z", "input": ["text": "新问"], "finalMessage": "新答"]], "messages": [], "tools": []]] as [String: Any]
        let old = try SupervisorClient.parseHistoryRecordForTesting(target, conversationID: "conv_test")
        let latest = try SupervisorClient.parseHistoryRecordForTesting(newer, conversationID: "conv_test")
        let overlap = try SupervisorClient.parseHistoryRecordForTesting(
            ["conversationId": "conv_test", "hasMoreBefore": true, "beforeCursor": "older_1", "liveCursor": "c3", "source": "durable", "runtime": ["conversationId": "conv_test", "turns": [["conversationId": "conv_test", "turnId": "turn_1", "startedAt": "2026-01-01T00:00:00Z", "input": ["text": "旧问"], "finalMessage": "旧答 updated"]], "messages": [], "tools": []]],
            conversationID: "conv_test"
        )
        let merged = SupervisorClient.mergeHistory(loaded: old, incoming: latest)
        XCTAssertEqual(merged.messages.map(\.text), ["旧问", "旧答", "新问", "新答"])
        XCTAssertEqual(merged.beforeCursor, "older_1")

        let olderPage = try SupervisorClient.parseHistoryRecordForTesting(
            ["conversationId": "conv_test", "hasMoreBefore": false, "historyComplete": true, "liveCursor": "old_cursor", "source": "durable", "runtime": ["conversationId": "conv_test", "turns": [["conversationId": "conv_test", "turnId": "turn_0", "startedAt": "2025-12-31T23:59:59Z", "input": ["text": "更旧问"], "finalMessage": "更旧答"]], "messages": [], "tools": []]],
            conversationID: "conv_test"
        )
        let prepended = SupervisorClient.mergeHistory(loaded: merged, incoming: olderPage, olderPage: true)
        XCTAssertEqual(prepended.messages.map(\.text), ["更旧问", "更旧答", "旧问", "旧答", "新问", "新答"])
        XCTAssertEqual(prepended.liveCursor, "c2")

        let authoritative = SupervisorClient.mergeHistory(loaded: merged, incoming: overlap)
        XCTAssertEqual(authoritative.messages.first(where: { $0.id == "final:turn_1" })?.text, "旧答 updated")
        XCTAssertEqual(authoritative.liveCursor, "c3")

        let incomingExtendsEarlier = try SupervisorClient.parseHistoryRecordForTesting(
            ["conversationId": "conv_test", "hasMoreBefore": true, "beforeCursor": "older_0", "liveCursor": "c4", "source": "durable", "runtime": ["conversationId": "conv_test", "turns": [
                ["conversationId": "conv_test", "turnId": "turn_0", "startedAt": "2025-12-31T23:59:59Z", "input": ["text": "最早问"], "finalMessage": "最早答"],
                ["conversationId": "conv_test", "turnId": "turn_1", "startedAt": "2026-01-01T00:00:00Z", "input": ["text": "旧问"], "finalMessage": "旧答 from latest"],
            ], "messages": [], "tools": []]],
            conversationID: "conv_test"
        )
        let extended = SupervisorClient.mergeHistory(loaded: merged, incoming: incomingExtendsEarlier)
        XCTAssertEqual(extended.messages.map(\.text), ["最早问", "最早答", "旧问", "旧答 from latest", "新问", "新答"])
        XCTAssertEqual(extended.messages.first(where: { $0.id == "final:turn_1" })?.text, "旧答 from latest")
        XCTAssertEqual(extended.beforeCursor, "older_0")
    }

    func testHistoryRefreshLoadsBridgePagesUntilItOverlapsLoadedRange() async throws {
        func page(turnID: String, question: String, cursor: String?, complete: Bool = false) throws -> ParsedHistory {
            var row: [String: Any] = [
                "conversationId": "conv_test", "hasMoreBefore": cursor != nil, "liveCursor": "live", "source": "durable",
                "runtime": ["conversationId": "conv_test", "turns": [["conversationId": "conv_test", "turnId": turnID, "startedAt": "2026-01-01T00:00:00Z", "input": ["text": question], "finalMessage": "答" ]], "messages": [], "tools": []],
            ]
            if let cursor { row["beforeCursor"] = cursor }
            if complete { row["historyComplete"] = true }
            return try SupervisorClient.parseHistoryRecordForTesting(row, conversationID: "conv_test")
        }
        let loaded = try page(turnID: "turn_1", question: "已加载", cursor: "loaded_before")
        let latest = try page(turnID: "turn_4", question: "最新", cursor: "gap_1")
        var requested: [String] = []
        let merged = try await SupervisorClient.reconcileHistory(loaded: loaded, latest: latest) { cursor in
            requested.append(cursor)
            switch cursor {
            case "gap_1": return try page(turnID: "turn_3", question: "中间二", cursor: "gap_2")
            case "gap_2": return try page(turnID: "turn_1", question: "已加载", cursor: "loaded_before")
            default: throw ClientFailure.invalidResponse
            }
        }
        XCTAssertEqual(requested, ["gap_1", "gap_2"])
        XCTAssertEqual(merged.messages.map(\.text), ["已加载", "答", "中间二", "答", "最新", "答"])
        XCTAssertEqual(merged.liveCursor, "live")
    }

    func testCompleteCachedHistoryStillLoadsBridgePages() async throws {
        func page(_ turns: [Int], before: String?, complete: Bool = false) throws -> ParsedHistory {
            var row: [String: Any] = [
                "conversationId": "conv_test", "hasMoreBefore": before != nil, "liveCursor": "latest",
                "source": "durable", "runtime": [
                    "conversationId": "conv_test", "turns": turns.map { turn in [
                        "conversationId": "conv_test", "turnId": "turn_\(turn)",
                        "startedAt": "2026-01-01T00:00:\(String(format: "%02d", turn))Z",
                        "input": ["text": "问\(turn)"], "finalMessage": "答\(turn)"
                    ] }, "messages": [], "tools": []
                ]
            ]
            if let before { row["beforeCursor"] = before }
            if complete { row["historyComplete"] = true }
            return try SupervisorClient.parseHistoryRecordForTesting(row, conversationID: "conv_test")
        }

        let loaded = try page([1, 2], before: nil, complete: true)
        let latest = try page(Array(5...12), before: "cursor_4")
        let merged = try await SupervisorClient.reconcileHistory(loaded: loaded, latest: latest) { cursor in
            switch cursor {
            case "cursor_4": return try page([4], before: "cursor_3")
            case "cursor_3": return try page([3], before: "cursor_2")
            case "cursor_2": return try page([2], before: "cursor_1")
            case "cursor_1": return try page([1], before: nil, complete: true)
            default: throw ClientFailure.invalidResponse
            }
        }
        XCTAssertEqual(merged.turns.compactMap { $0["turnId"] as? String }, (1...12).map { "turn_\($0)" })
        XCTAssertEqual(Set(merged.messages.map(\.id)).count, merged.messages.count)
    }

    func testHistoryWithoutOverlapFallsBackToLatest() async throws {
        func page(_ turn: String, before: String?, live: String) throws -> ParsedHistory {
            var row: [String: Any] = [
                "conversationId": "conv_test", "hasMoreBefore": before != nil, "liveCursor": live,
                "source": "durable", "runtime": ["conversationId": "conv_test", "turns": [[
                    "conversationId": "conv_test", "turnId": turn, "startedAt": "2026-01-01T00:00:00Z",
                    "input": ["text": turn], "finalMessage": "答"
                ]], "messages": [], "tools": []]
            ]
            if let before { row["beforeCursor"] = before }
            return try SupervisorClient.parseHistoryRecordForTesting(row, conversationID: "conv_test")
        }

        let loaded = try page("old", before: nil, live: "old-live")
        let latest = try page("new", before: nil, live: "new-live")
        let replaced = try await SupervisorClient.reconcileHistory(loaded: loaded, latest: latest) { _ in
            XCTFail("no cursor should mean replacement")
            return latest
        }
        XCTAssertEqual(replaced.liveCursor, "new-live")
        XCTAssertEqual(replaced.turns.compactMap { $0["turnId"] as? String }, ["new"])

        let repeated = try page("new", before: "same", live: "repeated-live")
        let repeatedResult = try await SupervisorClient.reconcileHistory(loaded: loaded, latest: repeated) { _ in repeated }
        XCTAssertEqual(repeatedResult.liveCursor, "repeated-live")
        XCTAssertEqual(repeatedResult.turns.compactMap { $0["turnId"] as? String }, ["new"])
    }

    func testLongChangePathUsesProtocolLimit() throws {
        let path = String(repeating: "a", count: 4_096)
        let file = try SupervisorClient.parseDiffFile([
            "turnId": "turn_1", "itemId": "item_1", "path": path, "diff": ""
        ])
        XCTAssertEqual(file.path.utf8.count, 4_096)
    }

    func testSimulatorReadsAndWritesThroughDirectAndRelay() async throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "InteropFixture", withExtension: "json"))
        let bytes = try Data(contentsOf: url)
        let values = try XCTUnwrap(JSONSerialization.jsonObject(with: bytes) as? [String: Any])
        let options = try options(from: values, mode: .direct)
        let signer = FixtureSigner()

        for mode in [ConnectionMode.direct, .relay] {
            var selected = options
            selected.mode = mode
            let session = try await Task.detached(priority: .userInitiated) {
                try connectSupervisor(options: selected, signer: signer)
            }.value

            let read = try await Task.detached(priority: .userInitiated) {
                try session.request(operationJson: "{\"operation\":\"machine.list\"}")
            }.value
            let readResult = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(read.utf8)) as? [String: Any])
            XCTAssertEqual(readResult["fixtureOperation"] as? String, "machine.list")

            let actionID = mode == .direct ? "act_ios_fixture_direct" : "act_ios_fixture_relay"
            let write = try await Task.detached(priority: .userInitiated) {
                let request: [String: Any] = [
                    "operation": "attention.resolve",
                    "attentionId": "attn_fixture_item",
                    "actionId": actionID,
                ]
                let json = try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
                return try session.request(operationJson: String(decoding: json, as: UTF8.self))
            }.value
            let writeResult = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(write.utf8)) as? [String: Any])
            XCTAssertEqual(writeResult["fixtureOperation"] as? String, "attention.resolve")
            XCTAssertEqual(writeResult["actionId"] as? String, actionID)

            await Task.detached(priority: .userInitiated) { session.disconnect() }.value
        }
    }

    private func options(from values: [String: Any], mode: ConnectionMode) throws -> ConnectOptions {
        func requiredString(_ key: String) throws -> String {
            try XCTUnwrap(values[key] as? String)
        }
        func encoded(_ key: String) throws -> String {
            let value = try XCTUnwrap(values[key])
            let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
            return String(decoding: data, as: UTF8.self)
        }
        return ConnectOptions(
            hostId: try requiredString("hostId"),
            hostFingerprint: try requiredString("hostFingerprint"),
            hostIdentityGeneration: 1,
            hostPublicJwkJson: try encoded("publicJwk"),
            deviceId: try requiredString("deviceId"),
            deviceKeyGeneration: 1,
            grantJson: try encoded("grant"),
            descriptorJson: try encoded("descriptor"),
            accessToken: try requiredString("accessToken"),
            mode: mode
        )
    }
}

private final class FixtureSigner: DeviceSigner, @unchecked Sendable {
    private let key: P256.Signing.PrivateKey

    init() {
        key = try! P256.Signing.PrivateKey(rawRepresentation: Data(repeating: 7, count: 32))
    }

    func signDer(message: Data) throws -> Data {
        try key.signature(for: message).derRepresentation
    }
}
