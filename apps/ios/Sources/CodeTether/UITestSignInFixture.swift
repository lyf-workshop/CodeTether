#if DEBUG
import Foundation

actor UITestSignInAccount: TabletAccountService {
    private var requestedEmail: String?
    private var requestCount = 0

    func restore() async throws -> AccountProfile? { nil }

    func requestSignInCode(email: String) async throws {
        requestedEmail = email
        requestCount += 1
        if email == "rate-limited@example.invalid" { throw ClientFailure.requestRateLimited }
        if email == "service-error@example.invalid" { throw ClientFailure.requestFailed }
    }

    func verifySignInCode(email: String, code: String) async throws -> AccountProfile {
        guard email == requestedEmail, code == "123456", requestCount >= 3 else {
            throw ClientFailure.verifyCodeFailed
        }
        return AccountProfile(id: "account_ui_test", email: email)
    }

    func signOut() async throws { }
    func directory() async throws -> [PairedComputer] { [] }
    func connectContext(computerID: String, mode: TabletConnectionMode) async throws -> SupervisorConnectContext {
        throw ClientFailure.computerUnavailable
    }
    func pair(code: String, onClaimed: @Sendable () -> Void) async throws -> PairedComputer {
        throw ClientFailure.computerUnavailable
    }
    func remove(computerID: String) async throws { }
}
#endif
