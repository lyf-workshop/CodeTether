import XCTest

final class SignInUITests: XCTestCase {
    func testExistingAccountSignInScreenAppearsWithoutStartingProviderWork() {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.textFields["signin-email"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["signin-submit"].exists)
        XCTAssertFalse(app.staticTexts["Account configuration is required."].exists)
    }
}
