import XCTest

final class NewSessionFailureUITests: XCTestCase {
    func testCreateFailureKeepsSheetAndFirstInputVisible() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-test-new-session-failure"]
        app.launch()

        let newSession = app.buttons["new-session-button"]
        XCTAssertTrue(newSession.waitForExistence(timeout: 10))
        newSession.tap()

        let input = app.descendants(matching: .any).matching(identifier: "new-session-input").firstMatch
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        input.tap()
        input.typeText("first sentence for UI regression")
        app.buttons["new-session-create"].tap()
        XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "new-session-error").firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(input.exists)
        XCTAssertEqual(input.value as? String, "first sentence for UI regression")
        XCTAssertTrue(app.buttons["new-session-create"].exists)
    }

    func testPendingCreateRestoresAfterSheetReopenAndRetryClosesSheet() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-test-pending-create-retry"]
        app.launch()

        let newSession = app.buttons["new-session-button"]
        XCTAssertTrue(newSession.waitForExistence(timeout: 10))
        newSession.tap()

        let input = app.descendants(matching: .any).matching(identifier: "new-session-input").firstMatch
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        XCTAssertEqual(input.value as? String, "保留这句原始请求")
        XCTAssertFalse(input.isEnabled)

        app.buttons["完成"].firstMatch.tap()
        XCTAssertTrue(newSession.waitForExistence(timeout: 5))
        newSession.tap()
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        XCTAssertEqual(input.value as? String, "保留这句原始请求")

        app.buttons["new-session-retry-uncertain"].tap()
        XCTAssertTrue(app.staticTexts["保留这句原始请求"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["new-session-retry-uncertain"].exists)
    }
}
