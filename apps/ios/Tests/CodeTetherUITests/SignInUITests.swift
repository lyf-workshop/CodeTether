import XCTest

final class SignInUITests: XCTestCase {
    func testExistingAccountSignInScreenAppearsWithoutStartingProviderWork() {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.textFields["signin-email"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["signin-submit"].exists)
        XCTAssertFalse(app.staticTexts["Account configuration is required."].exists)
    }

    func testResendAndChangeEmailUseTheRequestedAddress() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-test-sign-in-fixture"]
        app.launch()

        let email = app.textFields["signin-email"]
        let submit = app.buttons["signin-submit"]
        let code = app.textFields["signin-code"]
        XCTAssertTrue(email.waitForExistence(timeout: 10))
        email.tap()
        email.typeText("first@example.invalid")
        submit.tap()

        XCTAssertTrue(code.waitForExistence(timeout: 10))
        XCTAssertFalse(email.isEnabled)
        XCTAssertTrue(app.buttons["signin-resend"].exists)
        app.buttons["signin-resend"].tap()
        code.tap()
        code.typeText("12")
        app.buttons["signin-change-email"].tap()

        XCTAssertTrue(email.isEnabled)
        XCTAssertFalse(code.exists)
        email.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap()
        email.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: "first@example.invalid".count))
        email.typeText("second@example.invalid")
        submit.tap()

        XCTAssertTrue(code.waitForExistence(timeout: 10))
        XCTAssertFalse(email.isEnabled)
        code.tap()
        code.typeText("000000")
        submit.tap()
        XCTAssertTrue(app.staticTexts["验证码不正确或已过期，请检查后重试。"].waitForExistence(timeout: 5))
        code.tap()
        code.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 6))
        code.typeText("123456")
        submit.tap()
        XCTAssertTrue(app.buttons["new-session-button"].waitForExistence(timeout: 10))
    }

    func testSignInRequestFailuresShowDistinctMessages() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-test-sign-in-fixture"]
        app.launch()

        let email = app.textFields["signin-email"]
        let submit = app.buttons["signin-submit"]
        XCTAssertTrue(email.waitForExistence(timeout: 10))
        email.tap()
        email.typeText("rate-limited@example.invalid")
        submit.tap()
        XCTAssertTrue(app.staticTexts["尝试次数过多，请稍后再试。"].waitForExistence(timeout: 5))

        email.tap()
        email.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: "rate-limited@example.invalid".count))
        email.typeText("service-error@example.invalid")
        submit.tap()
        XCTAssertTrue(app.staticTexts["暂时无法连接服务，请检查网络后重试。"].waitForExistence(timeout: 5))
    }
}
