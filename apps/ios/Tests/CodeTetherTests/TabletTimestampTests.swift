import XCTest
@testable import CodeTether

final class TabletTimestampTests: XCTestCase {
    func testPairingExpiryAcceptsServerTimestampsAndRejectsExpiredOrInvalidValues() throws {
        let now = try XCTUnwrap(TabletTimestamp.parse("2026-11-07T04:00:00Z"))
        let fractional = try AccountClient.pairingExpiry("2026-11-07T04:05:00.000Z", now: now)
        let ordinary = try AccountClient.pairingExpiry("2026-11-07T04:05:00Z", now: now)
        XCTAssertEqual(fractional, ordinary)

        for value in ["2026-11-07T04:00:00.000Z", "2026-11-07T03:59:59Z"] {
            XCTAssertThrowsError(try AccountClient.pairingExpiry(value, now: now)) { error in
                guard case ClientFailure.pairingExpired = error else {
                    return XCTFail("Unexpected error: \(error)")
                }
            }
        }
        XCTAssertThrowsError(try AccountClient.pairingExpiry("not-a-date", now: now)) { error in
            guard case ClientFailure.invalidResponse = error else { return XCTFail("Unexpected error: \(error)") }
        }
    }
}
