import XCTest
import SwiftUI
@testable import CodeTether

final class AppModelRegressionTests: XCTestCase {
    @MainActor
    func testConversationDraftRestoresFromLocalDefaults() throws {
        let suite = "CodeTether.AppModelRegressionTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }

        let firstLaunch = TabletAppModel(defaults: defaults)
        firstLaunch.actions.updateDraft("conversation_test", "unfinished request")

        let relaunched = TabletAppModel(defaults: defaults)
        XCTAssertEqual(relaunched.state.conversationDrafts["conversation_test"], "unfinished request")
    }

    func testInactiveThenActiveDoesNotCancelPendingSendOrCreateWork() async {
        let counter = SubmissionCounter()
        var work: [Task<Bool, Never>] = []
        for operation in ["send", "create"] {
            await counter.recordSubmission(operation)
            work.append(Task {
                await counter.markStarted(operation)
                do {
                    try await Task.sleep(nanoseconds: 20_000_000)
                    return false
                } catch {
                    return true
                }
            })
        }
        await counter.waitUntilStarted(["send", "create"])

        for phase in [ScenePhase.inactive, .active] where TabletLifecyclePolicy.suspendsForegroundWork(for: phase) {
            work.forEach { $0.cancel() }
        }

        var cancelled: [Bool] = []
        for task in work {
            cancelled.append(await task.value)
        }
        let submissions = await counter.submissionCounts()
        XCTAssertEqual(submissions, ["send": 1, "create": 1])
        XCTAssertEqual(cancelled, [false, false])
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
