import Foundation
import SQLite3
import CryptoKit
import zlib

enum LegacyImport {
    static func workspace(_ root: URL) throws -> Backup {
        var database: OpaquePointer?
        let path = root.appendingPathComponent(".lifeos/core.db").path
        guard sqlite3_open_v2(path, &database, SQLITE_OPEN_READONLY, nil) == SQLITE_OK, let db = database else {
            if database != nil { sqlite3_close(database) }; throw LibraryError.invalidArchive
        }
        defer { sqlite3_close(db) }
        func rows(_ sql: String) throws -> [[String:String]] {
            var statement: OpaquePointer?
            guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK, let statement else { throw LibraryError.invalidArchive }
            defer { sqlite3_finalize(statement) }
            var result: [[String:String]] = []
            while true {
                let state = sqlite3_step(statement)
                if state == SQLITE_DONE { break }
                guard state == SQLITE_ROW else { throw LibraryError.invalidArchive }
                var row: [String:String] = [:]
                for column in 0..<sqlite3_column_count(statement) {
                    if let text = sqlite3_column_text(statement, column) { row[String(cString: sqlite3_column_name(statement, column))] = String(cString: text) }
                }
                result.append(row)
                guard result.count <= 50_000 else { throw LibraryError.tooLarge }
            }
            return result
        }
        func safeFile(_ relative: String) throws -> URL {
            guard !relative.contains("\\"), !relative.hasPrefix("/"), !relative.split(separator: "/").contains("..") else { throw LibraryError.invalidArchive }
            let file = root.appendingPathComponent(relative).standardizedFileURL.resolvingSymlinksInPath()
            guard file.path.hasPrefix(root.standardizedFileURL.resolvingSymlinksInPath().path+"/") else { throw LibraryError.invalidArchive }
            return file
        }
        func date(_ text: String?) -> Date {
            guard let text else { return Date() }
            let iso = ISO8601DateFormatter()
            if let value = iso.date(from: text) { return value }
            iso.formatOptions.insert(.withFractionalSeconds)
            return iso.date(from: text) ?? Date()
        }
        let notebook = Notebook(id: "lifeos-legacy", name: "从旧版带来", symbol: "archivebox")
        var workspace = Workspace(notebooks: [notebook])
        var files: [String:Data] = [:]
        for row in try rows("SELECT * FROM entries") {
            guard let id = row["entry_id"], let relative = row["source_path"] else { throw LibraryError.invalidArchive }
            let content = try String(contentsOf: safeFile("vault/"+relative), encoding: .utf8)
            let tags = row["tags_json"].flatMap { $0.data(using: .utf8) }.flatMap { try? JSONDecoder().decode([String].self, from: $0) } ?? []
            var page = Page(id: id, kind: row["kind"] == "daily" ? .journal : .note, title: row["title"] ?? "", body: content,
                journalDate: row["journal_date"], notebookID: notebook.id, tags: tags, createdAt: date(row["created_at"]), updatedAt: date(row["updated_at"]), deletedAt: row["deleted_at"].map { date($0) })
            // Revision rows and attachments are required when their tables exist;
            // a missing file fails the preview rather than silently losing data.
            for old in try rows("SELECT * FROM revisions WHERE entry_id='\(id.replacingOccurrences(of: "'", with: "''"))' ORDER BY created_at DESC LIMIT 30").reversed() {
                guard let revisionFile = old["revision_file"] else { throw LibraryError.invalidArchive }
                let body = try String(contentsOf: safeFile(revisionFile), encoding: .utf8)
                page.revisions.append(Revision(id: old["revision_id"] ?? UUID().uuidString, date: date(old["created_at"]), title: page.title, body: body))
            }
            for old in try rows("SELECT * FROM attachments WHERE entry_id='\(id.replacingOccurrences(of: "'", with: "''"))'") {
                guard let stored = old["stored_path"] else { throw LibraryError.invalidArchive }
                let data = try Data(contentsOf: safeFile(stored)); guard data.count <= 25_000_000 else { throw LibraryError.tooLarge }
                let name = old["original_name"] ?? "附件"
                let storedName = UUID().uuidString + "." + URL(fileURLWithPath:name).pathExtension
                page.attachments.append(Attachment(id: old["attachment_id"] ?? UUID().uuidString, name: name, storedName: storedName, bytes: data.count))
                files[storedName] = data
            }
            workspace.pages.append(page)
        }
        let stateURL = root.appendingPathComponent(".lifeos/ui-state.json")
        if FileManager.default.fileExists(atPath: stateURL.path) {
            let object = try JSONSerialization.jsonObject(with: Data(contentsOf: stateURL)) as? [String:Any]
            for (key,value) in object?["items"] as? [String:String] ?? [:] where key.hasPrefix("lifeos.writer.draft.") {
                guard let bytes=value.data(using:.utf8), let draft=try JSONSerialization.jsonObject(with:bytes) as? [String:Any] else { continue }
                let sections = draft["sections"] as? [String:String] ?? [:]
                let body = sections.sorted { $0.key < $1.key }.map { "## \($0.key)\n\n\($0.value)" }.joined(separator:"\n\n")
                guard !body.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty || !(draft["title"] as? String ?? "").isEmpty else { continue }
                workspace.pages.append(Page(id:"legacy-draft-"+String(key.suffix(10)), kind:.note, title:(draft["title"] as? String ?? "未完成的日记")+" · 旧版草稿", body:body, journalDate:String(key.suffix(10)), notebookID:notebook.id, tags:["恢复的草稿"]))
            }
        }
        try workspace.validate()
        return Backup(workspace: workspace, files: files)
    }

    static func zip(_ data: Data, temporary: URL) throws -> Backup {
        guard data.count <= 200_000_000 else { throw LibraryError.tooLarge }
        try SafeZIP.extract(data, to: temporary)
        let manifest = temporary.appendingPathComponent("backup_manifest.json")
        if FileManager.default.fileExists(atPath: manifest.path) {
            guard let object = try JSONSerialization.jsonObject(with: Data(contentsOf: manifest)) as? [String:Any], object["format"] as? String == "lifeos-backup-v1", let hashes = object["sha256"] as? [String:String] else { throw LibraryError.invalidArchive }
            for (name,expected) in hashes {
                guard SafeZIP.safe(name) else { throw LibraryError.invalidArchive }
                let content = try Data(contentsOf: temporary.appendingPathComponent(name))
                guard SHA256.hash(data:content).map({String(format:"%02x",$0)}).joined() == expected else { throw LibraryError.invalidArchive }
            }
        }
        return try workspace(temporary)
    }
}

enum SafeZIP {
    static func safe(_ path: String) -> Bool {
        !path.isEmpty && !path.hasPrefix("/") && !path.contains("\\") && !path.contains("\0") && !path.split(separator:"/").contains("..") && !path.contains(":")
    }
    static func extract(_ data: Data, to root: URL) throws {
        func number(_ offset: Int, _ length: Int) throws -> Int {
            guard offset >= 0, offset+length <= data.count else { throw LibraryError.invalidArchive }
            return (0..<length).reduce(0) { $0 | Int(data[offset+$1]) << ($1*8) }
        }
        guard data.count >= 22 else { throw LibraryError.invalidArchive }
        var end: Int?
        for position in stride(from:data.count-22,through:max(0,data.count-65557),by:-1) {
            if try number(position,4)==0x06054b50 { end=position;break }
        }
        guard let end, try number(end+4,2)==0, try number(end+6,2)==0 else { throw LibraryError.invalidArchive }
        let count=try number(end+10,2); var cursor=try number(end+16,4);var total=0;var names=Set<String>()
        guard count <= 20_000 else { throw LibraryError.tooLarge }
        try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true)
        for _ in 0..<count {
            guard try number(cursor,4)==0x02014b50, try number(cursor+8,2)&1==0 else { throw LibraryError.invalidArchive }
            let method=try number(cursor+10,2),crc=try number(cursor+16,4),compressed=try number(cursor+20,4),size=try number(cursor+24,4)
            let nameLength=try number(cursor+28,2),extra=try number(cursor+30,2),comment=try number(cursor+32,2),local=try number(cursor+42,4)
            let unixMode=(try number(cursor+38,4)) >> 16
            guard unixMode&0xf000 != 0xa000,cursor+46+nameLength <= data.count,let name=String(data:data.subdata(in:cursor+46..<cursor+46+nameLength),encoding:.utf8),safe(name),names.insert(name).inserted else { throw LibraryError.invalidArchive }
            cursor += 46+nameLength+extra+comment
            if name.hasSuffix("/") { continue }
            total += size;guard size<=50_000_000,total<=200_000_000 else { throw LibraryError.tooLarge }
            guard try number(local,4)==0x04034b50 else { throw LibraryError.invalidArchive }
            let start=local+30+(try number(local+26,2))+(try number(local+28,2))
            guard start>=0,start+compressed<=data.count else { throw LibraryError.invalidArchive }
            let input=data.subdata(in:start..<start+compressed)
            var output=Data(count:max(size,1))
            if method==0 { output=input }
            else if method==8 {
                var stream=z_stream()
                guard inflateInit2_(&stream,-MAX_WBITS,ZLIB_VERSION,Int32(MemoryLayout<z_stream>.size))==Z_OK else { throw LibraryError.invalidArchive }
                defer { inflateEnd(&stream) }
                let status=input.withUnsafeBytes { source in output.withUnsafeMutableBytes { destination in
                    stream.next_in=UnsafeMutablePointer<Bytef>(mutating:source.bindMemory(to:Bytef.self).baseAddress);stream.avail_in=uInt(input.count)
                    stream.next_out=destination.bindMemory(to:Bytef.self).baseAddress;stream.avail_out=uInt(max(size,1))
                    return inflate(&stream,Z_FINISH)
                }}
                guard status==Z_STREAM_END,stream.total_out==size else { throw LibraryError.invalidArchive }
                output.count=size
            } else { throw LibraryError.unsupported }
            let actualCRC=output.withUnsafeBytes { crc32(0,$0.bindMemory(to:Bytef.self).baseAddress,uInt(output.count)) }
            guard output.count==size,Int(actualCRC)==crc else { throw LibraryError.invalidArchive }
            let target=root.appendingPathComponent(name)
            try FileManager.default.createDirectory(at:target.deletingLastPathComponent(),withIntermediateDirectories:true)
            try output.write(to:target,options:.atomic)
        }
    }
}
