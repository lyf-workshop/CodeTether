import XCTest
@testable import CodeTether

final class AccountUnauthorizedResponseTests: XCTestCase {
    func testHumanAuthenticationFailureCodeIsRecognized() throws {
        let body = try JSONSerialization.data(withJSONObject: [
            "status": "authentication_failed",
            "code": "expired_token",
        ])

        XCTAssertTrue(AccountUnauthorizedResponseClassifier.isHumanAuthenticationFailure(status: 401, body: body))
    }

    func testDeviceAuthenticationFailureDoesNotInvalidateHumanSession() throws {
        let body = try JSONSerialization.data(withJSONObject: [
            "status": "device_authentication_failed",
            "code": "device_proof_invalid",
        ])

        XCTAssertFalse(AccountUnauthorizedResponseClassifier.isHumanAuthenticationFailure(status: 401, body: body))
        XCTAssertEqual(AccountUnauthorizedResponseClassifier.disposition(status: 401, body: body, attempt: 0), .refreshSession)
        XCTAssertEqual(AccountUnauthorizedResponseClassifier.disposition(status: 401, body: body, attempt: 1), .keepSession)
    }

    func testUnknownOrMalformedUnauthorizedResponseDoesNotInvalidateSession() {
        XCTAssertFalse(AccountUnauthorizedResponseClassifier.isHumanAuthenticationFailure(
            status: 401,
            body: Data("not-json".utf8)
        ))
        XCTAssertFalse(AccountUnauthorizedResponseClassifier.isHumanAuthenticationFailure(
            status: 401,
            body: Data(#"{"status":"authentication_failed","code":"new_code"}"#.utf8)
        ))
        XCTAssertEqual(AccountUnauthorizedResponseClassifier.disposition(
            status: 401,
            body: Data(#"{"status":"authentication_failed","code":"expired_token"}"#.utf8),
            attempt: 0
        ), .refreshSession)
        XCTAssertEqual(AccountUnauthorizedResponseClassifier.disposition(
            status: 401,
            body: Data(#"{"status":"authentication_failed","code":"expired_token"}"#.utf8),
            attempt: 1
        ), .clearSession)
        XCTAssertFalse(AccountUnauthorizedResponseClassifier.isHumanAuthenticationFailure(
            status: 403,
            body: Data(#"{"status":"authentication_failed","code":"expired_token"}"#.utf8)
        ))
    }

    func testFirstUnauthorizedResponseRefreshesBeforeClassification() throws {
        let body = try JSONSerialization.data(withJSONObject: [
            "status": "authentication_failed",
            "code": "expired_token",
        ])

        XCTAssertEqual(
            AccountUnauthorizedResponseClassifier.disposition(status: 401, body: body, attempt: 0),
            .refreshSession
        )
        XCTAssertEqual(
            AccountUnauthorizedResponseClassifier.disposition(status: 401, body: body, attempt: 1),
            .clearSession
        )
    }

    func testSecondDeviceUnauthorizedResponseKeepsSession() throws {
        let body = try JSONSerialization.data(withJSONObject: [
            "status": "device_authentication_failed",
            "code": "device_proof_invalid",
        ])

        XCTAssertEqual(
            AccountUnauthorizedResponseClassifier.disposition(status: 401, body: body, attempt: 0),
            .refreshSession
        )
        XCTAssertEqual(
            AccountUnauthorizedResponseClassifier.disposition(status: 401, body: body, attempt: 1),
            .keepSession
        )
    }
}
