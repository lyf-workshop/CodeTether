import XCTest
@testable import CodeTether

final class DeviceIdentityTests: XCTestCase {
    func testSimulatorDeviceIdentityUsesDebugSoftwareKey() throws {
        #if targetEnvironment(simulator)
        let identity = try DeviceIdentity.loadOrCreate(accountID: "i1-test-account")
        XCTAssertEqual(identity.protection, .softwareDebugSimulator)
        XCTAssertTrue(identity.fingerprint.hasPrefix("sha256:"))
        let signature = try identity.signDER(Data("fixture-signature".utf8))
        XCTAssertEqual(signature.first, 0x30)
        #else
        throw XCTSkip("The software-key exception is simulator-only.")
        #endif
    }
}
