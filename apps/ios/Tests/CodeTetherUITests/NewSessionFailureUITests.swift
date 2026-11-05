import XCTest

final class NewSessionFailureUITests: XCTestCase {
    func testCreateFailureKeepsSheetAndFirstInputVisible() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-test-new-session-failure"]
        app.launch()

        let newSession = app.buttons["new-session-button"]
        XCTAssertTrue(newSession.waitForExistence(timeout: 10))
        newSession.tap()

        let input = app.textFields["new-session-input"]
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        input.tap()
        input.typeText("first sentence for UI regression")
        app.buttons["new-session-create"].tap()

        XCTAssertTrue(app.staticTexts["new-session-error"].waitForExistence(timeout: 5))
        XCTAssertTrue(input.exists)
        XCTAssertEqual(input.value as? String, "first sentence for UI regression")
        XCTAssertTrue(app.buttons["new-session-create"].exists)
    }
}
