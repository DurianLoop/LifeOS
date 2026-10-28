import XCTest

final class LifeOSUITests:XCTestCase {
    var app:XCUIApplication!
    override func setUpWithError() throws {
        continueAfterFailure=false
        app=XCUIApplication()
        app.launchArguments=["--ui-testing","--reset-library","--seed-library","-AppleLanguages","(zh-Hans)","-AppleLocale","zh_CN"]
        app.launch()
        XCTAssertTrue(app.buttons["notes.create"].waitForExistence(timeout:15))
    }
    func capture(_ name:String){let shot=XCTAttachment(screenshot:app.screenshot());shot.name=name;shot.lifetime = .keepAlways;add(shot)}
    override func tearDownWithError()throws{
        if let app,let run=testRun,run.hasSucceeded==false {
            capture("failure")
            let tree=XCTAttachment(string:app.debugDescription);tree.name="accessibility-tree";tree.lifetime = .keepAlways;add(tree)
        }
    }
    func testNotesReaderAndBacklinks() throws {
        capture("01-notes")
        app.buttons["page.slow"].tap()
        XCTAssertTrue(app.staticTexts["reader.title"].waitForExistence(timeout:5))
        capture("02-reader")
        app.swipeUp()
        XCTAssertTrue(app.buttons["一些微小的发现"].exists || app.staticTexts["提到这一页"].exists)
        capture("03-links")
    }
    func testEditingAndRestartPersistence() throws {
        app.buttons["notes.create"].tap()
        let title=app.textFields["editor.title"]
        XCTAssertTrue(title.waitForExistence(timeout:5));title.tap();title.typeText("Acceptance note")
        let body=app.textViews["editor.body"];body.tap();body.typeText("A quiet place for ideas.\n\n## Reading\n- [ ] Read a book")
        capture("04-editor-keyboard")
        app.buttons["editor.done"].tap()
        XCTAssertTrue(app.buttons.containing(.staticText,identifier:"Acceptance note").firstMatch.waitForExistence(timeout:5))
        app.terminate()
        app.launchArguments=["--ui-testing","-AppleLanguages","(zh-Hans)","-AppleLocale","zh_CN"]
        app.launch()
        let note=app.buttons.containing(.staticText,identifier:"Acceptance note").firstMatch
        XCTAssertTrue(note.waitForExistence(timeout:10));note.tap()
        XCTAssertTrue(app.staticTexts["Acceptance note"].exists)
        XCTAssertTrue(app.staticTexts["A quiet place for ideas."].exists)
        capture("05-restarted-note")
    }
    func testSearchJournalAndLibrary() throws {
        app.tabBars.buttons["搜索"].tap()
        let search=app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout:5));search.tap();search.typeText("空白")
        XCTAssertTrue(app.buttons.containing(.staticText,identifier:"给生活留一点空白").firstMatch.waitForExistence(timeout:5))
        capture("06-search")
        app.tabBars.buttons["日记"].tap()
        XCTAssertTrue(app.buttons["journal.read"].waitForExistence(timeout:5))
        capture("07-journal")
        app.tabBars.buttons["资料库"].tap()
        XCTAssertTrue(app.buttons["library.addNotebook"].waitForExistence(timeout:5))
        capture("08-library")
        app.buttons["library.addNotebook"].tap()
        app.alerts.textFields.firstMatch.typeText("New notebook")
        app.alerts.buttons["创建"].tap()
        XCTAssertTrue(app.staticTexts["New notebook"].exists)
    }
    func testHistoryAndTrashRecovery() throws {
        app.buttons["page.slow"].tap();app.buttons["reader.menu"].tap();app.buttons["历史版本"].tap()
        capture("09-history")
        app.buttons.containing(.staticText,identifier:"给自己留一段没有安排的下午。").firstMatch.tap()
        app.buttons["恢复此版本"].tap()
        XCTAssertTrue(app.staticTexts["给自己留一段没有安排的下午。"].waitForExistence(timeout:5))
        app.buttons["reader.menu"].tap();app.buttons["移到废纸篓"].tap()
        app.buttons["移到废纸篓"].firstMatch.tap()
        app.tabBars.buttons["资料库"].tap();app.buttons["废纸篓"].tap()
        XCTAssertTrue(app.buttons["trash.restore.slow"].waitForExistence(timeout:5));capture("10-trash")
        app.buttons["trash.restore.slow"].tap()
        XCTAssertFalse(app.buttons["trash.restore.slow"].exists)
    }
    func testAppearanceAndNativeBackupPicker() throws {
        app.tabBars.buttons["资料库"].tap();app.buttons["外观与阅读"].tap()
        app.buttons["显示模式"].tap();app.buttons["深色"].tap()
        capture("11-dark-settings")
        app.navigationBars.buttons.element(boundBy:0).tap()
        app.buttons["导入与备份"].tap()
        capture("12-transfer")
        app.buttons["transfer.export"].tap()
        capture("13-native-backup-picker")
        XCTAssertTrue(app.navigationBars["移到"].waitForExistence(timeout:5) || app.buttons["存储"].waitForExistence(timeout:5) || app.buttons["导出"].exists || app.buttons["Save"].exists)
    }
    func testEmptyFirstRun() throws {
        app.terminate();app.launchArguments=["--ui-testing","--reset-library","-AppleLanguages","(zh-Hans)","-AppleLocale","zh_CN"];app.launch()
        XCTAssertTrue(app.buttons["notes.create"].waitForExistence(timeout:10))
        XCTAssertTrue(app.staticTexts["从空白的一页开始"].exists)
        capture("14-empty-library")
    }
}
