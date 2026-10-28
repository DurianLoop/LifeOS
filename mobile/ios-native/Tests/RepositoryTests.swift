import XCTest
import SQLite3
@testable import LifeOSCore

final class RepositoryTests:XCTestCase {
    var root:URL!
    override func setUpWithError() throws {root=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString);try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true)}
    override func tearDownWithError() throws {try? FileManager.default.removeItem(at:root)}

    func testJournalAndRevisionSurviveRestart() throws {
        let repo=try Repository(root:root)
        var page=Page(kind:.journal,title:"中文日记",body:"第一版",journalDate:"2026-10-28")
        try repo.save(page)
        page.body="第二版 [[另一页]]";try repo.save(page)
        let restarted=try Repository(root:root)
        let loaded=try XCTUnwrap(restarted.workspace.pages.first)
        XCTAssertEqual(loaded.id,page.id);XCTAssertEqual(loaded.body,page.body);XCTAssertEqual(loaded.revisions.first?.body,"第一版");XCTAssertEqual(loaded.wikiLinks,["另一页"])
        try restarted.restore(loaded.revisions[0],for:page.id)
        let restored=try XCTUnwrap(restarted.workspace.pages.first)
        XCTAssertEqual(restored.body,"第一版");XCTAssertTrue(restored.revisions.contains{$0.body=="第二版 [[另一页]]"})
    }
    func testBackupAttachmentsAndConflicts() throws {
        let repo=try Repository(root:root.appendingPathComponent("original"))
        let page=Page(title:"读书",body:"原文");try repo.save(page)
        let bytes=Data([0,1,2,255])
        _ = try repo.addAttachment(data:bytes,name:"picture.dat",page:page)
        let backup=try repo.decodeBackup(repo.backupData())
        let other=try Repository(root:root.appendingPathComponent("other"))
        XCTAssertEqual(try other.merge(backup),1)
        let attachment=try XCTUnwrap(other.workspace.pages.first?.attachments.first)
        XCTAssertEqual(try Data(contentsOf:other.attachmentsURL.appendingPathComponent(attachment.storedName)),bytes)
        // Stable IDs plus semantic equality skip repeated imports even after files are relocated.
        XCTAssertEqual(try other.merge(backup),0)
        var changed=try XCTUnwrap(other.workspace.pages.first);changed.body="保留本机修改";try other.save(changed)
        XCTAssertEqual(try other.merge(backup),1)
        XCTAssertEqual(other.workspace.pages.count,2)
        XCTAssertTrue(other.workspace.pages.contains{$0.body=="保留本机修改"})
    }
    func testDamagedStoreRecoveryRetainsEvidence() throws {
        let repo=try Repository(root:root);var page=Page(title:"保留",body:"安全快照");try repo.save(page);page.body="下一版";try repo.save(page)
        try Data("broken".utf8).write(to:repo.storeURL)
        let recovered=try Repository(root:root)
        XCTAssertNotNil(recovered.recoveryMessage);XCTAssertEqual(recovered.workspace.pages.first?.body,"安全快照")
        try recovered.commit(recovered.workspace)
        XCTAssertTrue(try FileManager.default.contentsOfDirectory(at:root,includingPropertiesForKeys:nil).contains{$0.lastPathComponent.hasPrefix("Library.damaged-")})
        try Data("broken".utf8).write(to:repo.storeURL);try Data("also broken".utf8).write(to:repo.previousURL)
        XCTAssertThrowsError(try Repository(root:root))
    }
    func testSearchTrashAndMetadata() throws {
        let repo=try Repository(root:root)
        var page=Page(title:"Reading",body:"我在海边读书",notebookID:"book",tags:["随想"]);try repo.save(page)
        XCTAssertEqual(repo.search("海边 reading",notebook:"book").count,1)
        XCTAssertEqual(repo.search("随想").count,1)
        XCTAssertTrue(repo.search("海边",tag:"missing").isEmpty)
        page.deletedAt=Date();try repo.save(page)
        XCTAssertTrue(repo.search("Reading").isEmpty)
        page.deletedAt=nil;try repo.save(page);XCTAssertEqual(repo.search("Reading").count,1)
    }
    func testSearchExcerptFindsTextBeyondOpening() {
        let page=Page(title:"长笔记",body:String(repeating:"慢慢积累一些想法。",count:40)+"这次想记住的是星空与海岸。"+String(repeating:"继续写下去。",count:30))
        let snippet=page.searchExcerpt("星空")
        XCTAssertTrue(snippet.contains("星空与海岸"))
        XCTAssertTrue(snippet.hasPrefix("…"));XCTAssertTrue(snippet.hasSuffix("…"))
        XCTAssertLessThanOrEqual(snippet.count,112)
        XCTAssertEqual(page.searchExcerpt("不存在"),page.excerpt)
    }
    func testEmptyDraftKeepsIntentionalMetadata() {
        XCTAssertTrue(Page(title:" \n",body:"\n ").isEmptyDraft)
        XCTAssertFalse(Page(tags:["阅读"]).isEmptyDraft)
        XCTAssertFalse(Page(pinned:true).isEmptyDraft)
        XCTAssertFalse(Page(body:"一句话").isEmptyDraft)
    }
    func testRejectsInvalidBackupAndUnsafePaths() throws {
        let repo=try Repository(root:root)
        let p=Page(title:"test",attachments:[Attachment(name:"bad",storedName:"../escape",bytes:0)])
        XCTAssertThrowsError(try repo.commit(Workspace(pages:[p])))
        let encoded=try JSONEncoder().encode(Backup(workspace:Workspace(pages:[Page(title:"file",attachments:[Attachment(name:"missing",storedName:"safe",bytes:4)])]),files:[:]))
        XCTAssertThrowsError(try repo.decodeBackup(encoded))
        for name in ["../escape","/absolute","a/../../outside","a\\outside","C:/path","a\0b"]{XCTAssertFalse(SafeZIP.safe(name))}
        XCTAssertThrowsError(try SafeZIP.extract(Data("not a zip".utf8),to:root.appendingPathComponent("unzip")))
    }
    func testZIPInflationCRCAndTraversal()throws{
        let valid=Data(base64Encoded:"UEsDBBQAAAAIABCnXF1KbAgwDgAAAAwAAAAPAAAAbm90ZXMvcmVhZG1lLm1k80jNyclXeLJj7bNp7QBQSwECFAAUAAAACAAQp1xdSmwIMA4AAAAMAAAADwAAAAAAAAAAAAAAgAEAAAAAbm90ZXMvcmVhZG1lLm1kUEsFBgAAAAABAAEAPQAAADsAAAAAAA==")!
        let output=root.appendingPathComponent("zip")
        try SafeZIP.extract(valid,to:output)
        XCTAssertEqual(try String(contentsOf:output.appendingPathComponent("notes/readme.md"),encoding:.utf8),"Hello 中文")
        var damaged=valid;damaged[46] ^= 0xff
        XCTAssertThrowsError(try SafeZIP.extract(damaged,to:root.appendingPathComponent("bad-crc")))
        let traversal=Data(base64Encoded:"UEsDBBQAAAAIABCnXF1KbAgwDgAAAAwAAAAMAAAALi4vZXNjYXBlLm1k80jNyclXeLJj7bNp7QBQSwECFAAUAAAACAAQp1xdSmwIMA4AAAAMAAAADAAAAAAAAAAAAAAAgAEAAAAALi4vZXNjYXBlLm1kUEsFBgAAAAABAAEAOgAAADgAAAAAAA==")!
        XCTAssertThrowsError(try SafeZIP.extract(traversal,to:root.appendingPathComponent("unsafe")))
        XCTAssertFalse(FileManager.default.fileExists(atPath:root.appendingPathComponent("escape.md").path))
    }
    func testMarkdownImportAndExportKeepsWriting() throws {
        let repo=try Repository(root:root)
        let page=try repo.importMarkdown(Data("# 读书札记\n\n中文 **原文**\n- [ ] 待办\n[[关联]]".utf8),name:"note.md")
        XCTAssertEqual(page.title,"读书札记");XCTAssertTrue(page.body.contains("**原文**"));XCTAssertTrue(repo.markdown(page).contains("[[关联]]"))
        XCTAssertThrowsError(try repo.importMarkdown(Data([255,254,253]),name:"broken.txt"))
    }
    func testMarkdownTasksAndUnicodeLinks()throws{
        let line="- [ ] 保留任务里的 - [ ] 原文"
        XCTAssertEqual(Markdown.toggleTask(line,line:0),"- [x] 保留任务里的 - [ ] 原文")
        XCTAssertEqual(Markdown.toggleTask(line,line:3),line)
        let text="前言 [[生活 🍵]]，再回到 [[另一页]]。"
        XCTAssertEqual(Markdown.linkTitles(text),["生活 🍵","另一页"])
        let rendered=Markdown.inlineLinks(text)
        XCTAssertTrue(rendered.contains("[生活 🍵](lifeos://note?title="));XCTAssertTrue(rendered.contains("[另一页](lifeos://note?title="))
        XCTAssertTrue(rendered.hasSuffix("。"))
        let metadata="---\r\nlifeos_entry_id: old\r\n---\r\n\r\n- [ ] 保留文字"
        XCTAssertEqual(Markdown.toggleVisibleTask(metadata,line:0),"---\nlifeos_entry_id: old\n---\n\n- [x] 保留文字")
    }
    func testFencedCodeKeepsSourceLineIdentity()throws{
        let source="---\nentry: old\n---\n\n## Code\n\n```swift\nlet value = \"**literal**\"\n- [ ] not a task\n```\n\n- [ ] Actual task\n\n---"
        let blocks=Markdown.blocks(source)
        let code=try XCTUnwrap(blocks.first{$0.kind == .code})
        XCTAssertEqual(code.language,"swift")
        XCTAssertEqual(code.text,"let value = \"**literal**\"\n- [ ] not a task")
        XCTAssertEqual(blocks.last?.kind,.divider)
        let task=try XCTUnwrap(blocks.first{$0.kind == .line && $0.text.hasPrefix("- [ ]")})
        let changed=Markdown.toggleVisibleTask(source,line:task.id)
        XCTAssertTrue(changed.contains("- [ ] not a task"))
        XCTAssertTrue(changed.contains("- [x] Actual task"))
        XCTAssertEqual(Markdown.blocks("~~~text\n中文代码").first?.text,"中文代码")
    }
    func testLegacyDatabaseMigrationPreservesOriginal() throws {
        let workspace=root.appendingPathComponent("legacy")
        try FileManager.default.createDirectory(at:workspace.appendingPathComponent(".lifeos"),withIntermediateDirectories:true)
        try FileManager.default.createDirectory(at:workspace.appendingPathComponent("vault"),withIntermediateDirectories:true)
        let dbURL=workspace.appendingPathComponent(".lifeos/core.db")
        var db:OpaquePointer?
        XCTAssertEqual(sqlite3_open(dbURL.path,&db),SQLITE_OK)
        let sql="""
        CREATE TABLE entries(entry_id TEXT,kind TEXT,journal_date TEXT,title TEXT,tags_json TEXT,source_path TEXT,created_at TEXT,updated_at TEXT,deleted_at TEXT);
        CREATE TABLE revisions(revision_id TEXT,entry_id TEXT,revision_file TEXT,created_at TEXT);
        CREATE TABLE attachments(attachment_id TEXT,entry_id TEXT,stored_path TEXT,original_name TEXT);
        INSERT INTO entries VALUES('legacy-id','daily','2026-10-28','从旧版带来','["生活"]','day.md','2026-10-28T00:00:00Z','2026-10-28T00:00:00Z',NULL);
        INSERT INTO revisions VALUES('r1','legacy-id','.lifeos/old.md','2026-10-28T00:00:00Z');
        INSERT INTO attachments VALUES('a1','legacy-id','.lifeos/file.txt','原附件.txt');
        """
        XCTAssertEqual(sqlite3_exec(db,sql,nil,nil,nil),SQLITE_OK);sqlite3_close(db)
        try Data("正文".utf8).write(to:workspace.appendingPathComponent("vault/day.md"))
        try Data("原修订".utf8).write(to:workspace.appendingPathComponent(".lifeos/old.md"))
        try Data("原附件".utf8).write(to:workspace.appendingPathComponent(".lifeos/file.txt"))
        let original=try Data(contentsOf:dbURL)
        let result=try LegacyImport.workspace(workspace)
        XCTAssertEqual(result.workspace.pages.first?.id,"legacy-id");XCTAssertEqual(result.workspace.pages.first?.revisions.first?.body,"原修订");XCTAssertEqual(result.files.count,1)
        XCTAssertEqual(try Data(contentsOf:dbURL),original)
    }
}
