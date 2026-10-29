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
    func reveal(_ element:XCUIElement){
        for _ in 0..<5 {if element.exists && element.isHittable{return};app.swipeUp()}
        XCTAssertTrue(element.waitForExistence(timeout:3))
        XCTAssertTrue(element.isHittable)
    }
    func selectTab(_ title:String){
        let button=app.tabBars.buttons[title]
        XCTAssertEqual(XCTWaiter.wait(for:[XCTNSPredicateExpectation(predicate:NSPredicate{_,_ in button.exists && button.isHittable},object:nil)],timeout:12),.completed)
        button.tap()
        XCTAssertEqual(XCTWaiter.wait(for:[XCTNSPredicateExpectation(predicate:NSPredicate{_,_ in button.isSelected},object:nil)],timeout:8),.completed)
    }
    override func tearDownWithError()throws{
        if let app,let run=testRun,run.failureCount>0 {
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
        app.buttons["标为已完成"].tap()
        XCTAssertEqual(app.buttons.matching(identifier:"标为未完成").count,2)
        app.links["一些微小的发现"].tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format:"identifier == %@ AND label == %@","reader.title","一些微小的发现")).firstMatch.waitForExistence(timeout:5))
        app.navigationBars.buttons.element(boundBy:0).tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format:"identifier == %@ AND label == %@","reader.title","给生活留一点空白")).firstMatch.waitForExistence(timeout:5))
    }
    func testEditingAndRestartPersistence() throws {
        app.buttons["notes.create"].tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout:5))
        let title=app.textFields["editor.title"]
        XCTAssertTrue(title.waitForExistence(timeout:5));title.tap();title.typeText("Acceptance note")
        let body=app.textViews["editor.body"];XCTAssertTrue(body.waitForExistence(timeout:5));body.tap();body.typeText("A quiet place for ideas.\n\n## Reading\n- [ ] Read a book")
        capture("04-editor-keyboard")
        app.buttons["editor.properties"].tap()
        app.textFields["properties.tags"].tap();app.textFields["properties.tags"].typeText("reading, focus")
        app.buttons["properties.done"].tap()
        app.buttons["editor.done"].tap()
        XCTAssertTrue(app.buttons.containing(.staticText,identifier:"Acceptance note").firstMatch.waitForExistence(timeout:5))
        app.terminate()
        app.launchArguments=["--ui-testing","-AppleLanguages","(zh-Hans)","-AppleLocale","zh_CN"]
        app.launch()
        let note=app.buttons.containing(.staticText,identifier:"Acceptance note").firstMatch
        XCTAssertTrue(note.waitForExistence(timeout:10));note.tap()
        XCTAssertTrue(app.staticTexts["Acceptance note"].exists)
        XCTAssertTrue(app.staticTexts["A quiet place for ideas."].exists)
        XCTAssertTrue(app.staticTexts["#focus"].exists)
        capture("05-restarted-note")
    }
    func testSearchJournalAndLibrary() throws {
        selectTab("搜索")
        let search=app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout:5));search.tap();search.typeText("空白")
        XCTAssertTrue(app.buttons.containing(.staticText,identifier:"给生活留一点空白").firstMatch.waitForExistence(timeout:5))
        capture("06-search")
        search.typeText("\n")
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout:5))
        app.buttons.containing(.staticText,identifier:"给生活留一点空白").firstMatch.tap()
        XCTAssertTrue(app.staticTexts["reader.title"].waitForExistence(timeout:5))
        app.navigationBars.buttons.element(boundBy:0).tap()
        XCTAssertTrue(search.waitForExistence(timeout:5));XCTAssertEqual(search.value as? String,"空白")
        selectTab("日记")
        XCTAssertTrue(app.buttons["journal.read"].waitForExistence(timeout:5))
        capture("07-journal")
        app.buttons["journal.calendar"].tap()
        XCTAssertTrue(app.buttons["journal.calendar.done"].waitForExistence(timeout:5))
        capture("17-calendar")
        app.buttons["journal.calendar.done"].tap()
        app.buttons["journal.previousWeek"].tap()
        XCTAssertTrue(app.buttons["journal.today"].waitForExistence(timeout:5))
        app.buttons["journal.today"].tap()
        XCTAssertTrue(app.buttons["journal.read"].waitForExistence(timeout:5))
        selectTab("资料库")
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
        XCTAssertTrue(app.staticTexts["reader.title"].waitForNonExistence(timeout:10))
        selectTab("资料库");reveal(app.buttons["library.trash"]);app.buttons["library.trash"].tap()
        XCTAssertTrue(app.buttons["trash.restore.slow"].waitForExistence(timeout:5));capture("10-trash")
        app.buttons["trash.restore.slow"].tap()
        XCTAssertFalse(app.buttons["trash.restore.slow"].exists)
    }
    func testDeleteCanBeUndoneWithoutLeavingNotes() throws {
        app.buttons["page.slow"].tap();app.buttons["reader.menu"].tap();app.buttons["移到废纸篓"].tap()
        app.buttons["移到废纸篓"].firstMatch.tap()
        let undo=app.buttons["trash.undo"]
        XCTAssertTrue(undo.waitForExistence(timeout:5));capture("19-delete-undo")
        undo.tap()
        XCTAssertTrue(app.buttons["page.slow"].waitForExistence(timeout:5))
        XCTAssertFalse(app.buttons["trash.undo"].exists);capture("20-undo-restored")
        app.buttons["notebook.life"].tap()
        app.buttons["page.slow"].tap()
        app.navigationBars.buttons.element(boundBy:0).tap()
        XCTAssertTrue(app.navigationBars["生活札记"].waitForExistence(timeout:5))
        app.buttons["page.slow"].tap()
        app.buttons["reader.menu"].tap();app.buttons["移到废纸篓"].tap();app.buttons["移到废纸篓"].firstMatch.tap()
        XCTAssertTrue(app.navigationBars["生活札记"].waitForExistence(timeout:5))
        XCTAssertTrue(undo.waitForExistence(timeout:5));capture("21-notebook-undo")
        undo.tap()
        XCTAssertTrue(app.buttons["page.slow"].waitForExistence(timeout:5))
    }
    func testAppearanceAndNativeBackupPicker() throws {
        selectTab("资料库");reveal(app.buttons["library.settings"]);app.buttons["library.settings"].tap()
        app.buttons["settings.appearance"].tap();app.buttons["深色"].tap()
        capture("11-dark-settings")
        app.navigationBars.buttons.element(boundBy:0).tap()
        app.buttons["导入与备份"].tap()
        capture("12-transfer")
        app.buttons["transfer.export"].tap()
        let save=app.navigationBars.buttons["保存"]
        XCTAssertTrue(save.waitForExistence(timeout:30));XCTAssertTrue(save.isEnabled)
        capture("13-native-backup-picker")
        save.tap()
        XCTAssertTrue(save.waitForNonExistence(timeout:30))
        XCTAssertTrue(app.buttons["transfer.export"].exists)
        XCTAssertFalse(app.alerts["暂未完成"].exists)
        capture("18-backup-saved")
    }
    func testEmptyFirstRun() throws {
        app.terminate();app.launchArguments=["--ui-testing","--reset-library","-AppleLanguages","(zh-Hans)","-AppleLocale","zh_CN"];app.launch()
        XCTAssertTrue(app.buttons["notes.create"].waitForExistence(timeout:10))
        XCTAssertTrue(app.staticTexts["从空白的一页开始"].exists)
        capture("14-empty-library")
        app.buttons["notes.create"].tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout:5))
        app.buttons["editor.done"].tap()
        XCTAssertTrue(app.staticTexts["从空白的一页开始"].waitForExistence(timeout:5))
    }
    func testAccessibilityLargeText() throws {
        app.terminate()
        app.launchArguments += ["-UIPreferredContentSizeCategoryName","UICTContentSizeCategoryAccessibilityXXXL"]
        app.launch()
        XCTAssertTrue(app.buttons["notes.create"].waitForExistence(timeout:10))
        capture("15-accessibility-notes")
        reveal(app.buttons["page.slow"]);app.buttons["page.slow"].tap()
        let title=app.staticTexts["reader.title"]
        XCTAssertTrue(title.waitForExistence(timeout:5))
        XCTAssertGreaterThan(title.frame.height,65)
        XCTAssertGreaterThanOrEqual(title.frame.minX,0)
        XCTAssertLessThanOrEqual(title.frame.maxX,app.frame.width)
        capture("16-accessibility-reader")
    }
}
