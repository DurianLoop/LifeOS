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
        let withFile=try repo.addAttachment(data:bytes,name:"picture.dat",page:page)
        let backup=try repo.decodeBackup(repo.backupData())
        let other=try Repository(root:root.appendingPathComponent("other"))
        XCTAssertEqual(try other.merge(backup),1)
        let attachment=try XCTUnwrap(other.workspace.pages.first?.attachments.first)
        XCTAssertEqual(try Data(contentsOf:other.attachmentsURL.appendingPathComponent(attachment.storedName)),bytes)
        // Stable IDs plus semantic equality skip repeated imports even after files are relocated.
        XCTAssertEqual(try other.merge(backup),0)
        var changed=withFile;changed.body="保留本机修改";try other.save(changed)
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
    func testRejectsInvalidBackupAndUnsafePaths() throws {
        let repo=try Repository(root:root)
        let p=Page(title:"test",attachments:[Attachment(name:"bad",storedName:"../escape",bytes:0)])
        XCTAssertThrowsError(try repo.commit(Workspace(pages:[p])))
        let encoded=try JSONEncoder().encode(Backup(workspace:Workspace(pages:[Page(title:"file",attachments:[Attachment(name:"missing",storedName:"safe",bytes:4)])]),files:[:]))
        XCTAssertThrowsError(try repo.decodeBackup(encoded))
        for name in ["../escape","/absolute","a/../../outside","a\\outside","C:/path","a\0b"]{XCTAssertFalse(SafeZIP.safe(name))}
        XCTAssertThrowsError(try SafeZIP.extract(Data("not a zip".utf8),to:root.appendingPathComponent("unzip")))
    }
    func testMarkdownImportAndExportKeepsWriting() throws {
        let repo=try Repository(root:root)
        let page=try repo.importMarkdown(Data("# 读书札记\n\n中文 **原文**\n- [ ] 待办\n[[关联]]".utf8),name:"note.md")
        XCTAssertEqual(page.title,"读书札记");XCTAssertTrue(page.body.contains("**原文**"));XCTAssertTrue(repo.markdown(page).contains("[[关联]]"))
        XCTAssertThrowsError(try repo.importMarkdown(Data([255,254,253]),name:"broken.txt"))
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
