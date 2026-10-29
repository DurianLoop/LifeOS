import Foundation

final class Repository {
    let root: URL
    private(set) var workspace: Workspace
    private(set) var recoveryMessage: String?
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()
    private var primaryIsHealthy = true
    var attachmentsURL: URL { root.appendingPathComponent("Attachments", isDirectory: true) }
    var storeURL: URL { root.appendingPathComponent("Library.json") }
    var previousURL: URL { root.appendingPathComponent("Library.previous.json") }

    init(root: URL) throws {
        self.root = root
        self.workspace = Workspace()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try FileManager.default.createDirectory(at: attachmentsURL, withIntermediateDirectories: true)
        if FileManager.default.fileExists(atPath: storeURL.path) {
            do {
                workspace = try decoder.decode(Workspace.self, from: Data(contentsOf: storeURL)); try workspace.validate()
            } catch {
                guard let data = try? Data(contentsOf: previousURL), let recovered = try? decoder.decode(Workspace.self, from: data), (try? recovered.validate()) != nil else { throw LibraryError.corruptStore }
                workspace = recovered; primaryIsHealthy = false
                recoveryMessage = "已从上一份本地快照恢复，请立即导出备份。损坏的原文件保留在资料库内。"
            }
        }
    }

    func commit(_ updated: Workspace) throws {
        try updated.validate()
        let bytes = try encoder.encode(updated)
        guard bytes.count <= 100_000_000 else { throw LibraryError.tooLarge }
        if FileManager.default.fileExists(atPath: storeURL.path) {
            let existing = try Data(contentsOf: storeURL)
            if primaryIsHealthy { try write(existing, to: previousURL) }
            else { try write(existing, to: root.appendingPathComponent("Library.damaged-\(UUID().uuidString).json")) }
        }
        try write(bytes, to: storeURL)
        primaryIsHealthy = true
        workspace = updated
    }

    private func write(_ data: Data, to url: URL) throws {
        #if os(iOS)
        try data.write(to: url, options: [.atomic, .completeFileProtectionUnlessOpen])
        #else
        try data.write(to: url, options: [.atomic])
        #endif
    }

    func save(_ page: Page, now: Date = Date()) throws {
        var updated = workspace
        var page = page
        if let index = updated.pages.firstIndex(where: { $0.id == page.id }) {
            let old = updated.pages[index]
            if old == page { return }
            if old.title != page.title || old.body != page.body {
                // Coalesce typing into five-minute snapshots; explicit restoration
                // retains a snapshot of the content that it replaces.
                if page.revisions.isEmpty || now.timeIntervalSince(page.revisions.last!.date) > 300 {
                    page.revisions.append(Revision(date: now, title: old.title, body: old.body))
                }
                page.revisions = Array(page.revisions.suffix(30))
            }
            page.updatedAt = now
            updated.pages[index] = page
        } else { updated.pages.append(page) }
        try commit(updated)
    }

    func restore(_ revision: Revision, for id: String) throws {
        guard var page = workspace.pages.first(where: { $0.id == id }) else { return }
        page.revisions.append(Revision(title: page.title, body: page.body))
        page.title = revision.title; page.body = revision.body; page.updatedAt = Date()
        var updated = workspace
        updated.pages[updated.pages.firstIndex(where: { $0.id == id })!] = page
        try commit(updated)
    }

    func addAttachment(data: Data, name: String, page: Page) throws -> Page {
        guard data.count <= 25_000_000 else { throw LibraryError.tooLarge }
        let safeName = URL(fileURLWithPath: name).lastPathComponent
        let stored = UUID().uuidString + "." + URL(fileURLWithPath: safeName).pathExtension
        let attachment = Attachment(name: safeName, storedName: stored, bytes: data.count)
        try write(data, to: attachmentsURL.appendingPathComponent(stored))
        var page = page; page.attachments.append(attachment)
        try save(page)
        return workspace.pages.first(where:{$0.id==page.id}) ?? page
    }

    func backupData() throws -> Data {
        var files: [String:Data] = [:]
        var total = 0
        for attachment in workspace.pages.flatMap(\.attachments) {
            guard let data = try? Data(contentsOf: attachmentsURL.appendingPathComponent(attachment.storedName)) else { throw LibraryError.missingFile(attachment.name) }
            total += data.count; guard total <= 140_000_000 else { throw LibraryError.tooLarge }
            files[attachment.storedName] = data
        }
        return try encoder.encode(Backup(workspace: workspace, files: files))
    }

    func decodeBackup(_ data: Data) throws -> Backup {
        guard data.count <= 200_000_000 else { throw LibraryError.tooLarge }
        let backup = try decoder.decode(Backup.self, from: data)
        guard backup.application == "LifeOS Native", backup.version == 1 else { throw LibraryError.invalidArchive }
        try backup.workspace.validate()
        for attachment in backup.workspace.pages.flatMap(\.attachments) {
            guard let bytes = backup.files[attachment.storedName], bytes.count == attachment.bytes else { throw LibraryError.missingFile(attachment.name) }
        }
        return backup
    }

    @discardableResult func merge(_ backup: Backup) throws -> Int {
        try backup.workspace.validate()
        var updated = workspace
        var count = 0
        for book in backup.workspace.notebooks where !updated.notebooks.contains(where: { $0.id == book.id }) { updated.notebooks.append(book) }
        for source in backup.workspace.pages {
            if updated.pages.contains(where: { existing in
                var normalized=source
                normalized.attachments=existing.attachments
                return normalized==existing && zip(source.attachments,existing.attachments).allSatisfy { a,b in
                    a.name==b.name && a.bytes==b.bytes && backup.files[a.storedName]==(try? Data(contentsOf:attachmentsURL.appendingPathComponent(b.storedName)))
                } && source.attachments.count==existing.attachments.count
            }) { continue }
            var page = source
            if updated.pages.contains(where: { $0.id == page.id }) {
                page.id = UUID().uuidString; page.title = page.displayTitle + " · 导入副本"
            }
            var attachments: [Attachment] = []
            for item in page.attachments {
                guard let data = backup.files[item.storedName], data.count == item.bytes else { throw LibraryError.missingFile(item.name) }
                var copy = item; copy.id = UUID().uuidString; copy.storedName = UUID().uuidString + "." + URL(fileURLWithPath: item.name).pathExtension
                try write(data, to: attachmentsURL.appendingPathComponent(copy.storedName))
                attachments.append(copy)
            }
            page.attachments = attachments
            updated.pages.append(page); count += 1
        }
        try commit(updated)
        return count
    }

    func search(_ query: String, notebook: String? = nil, tag: String? = nil) -> [Page] {
        let terms = query.split(whereSeparator: \.isWhitespace).map(String.init)
        return workspace.pages.filter { page in
            page.deletedAt == nil && (notebook == nil || page.notebookID == notebook) && (tag == nil || page.tags.contains(tag!)) && terms.allSatisfy { term in
                if term.hasPrefix("#"), !term.hasPrefix("##"), term.count>1 {
                    return page.tags.contains{$0.localizedStandardContains(String(term.dropFirst()))}
                }
                return (page.title + "\n" + page.body + "\n" + page.tags.joined(separator: " ")).localizedStandardContains(term)
            }
        }.sorted { $0.updatedAt > $1.updatedAt }
    }

    func markdown(_ page: Page) -> String {
        let tags = page.tags.map { "#"+$0 }.joined(separator: " ")
        return "# \(page.displayTitle)\n\n" + (tags.isEmpty ? "" : tags+"\n\n") + page.body + "\n"
    }

    func importMarkdown(_ data: Data, name: String) throws -> Page {
        guard data.count <= 8_000_000 else { throw LibraryError.tooLarge }
        guard var body = String(data: data, encoding: .utf8) else { throw LibraryError.unsupported }
        var title = URL(fileURLWithPath: name).deletingPathExtension().lastPathComponent
        if body.hasPrefix("# "), let newline = body.firstIndex(of: "\n") {
            title = String(body[body.index(body.startIndex, offsetBy: 2)..<newline]); body = String(body[body.index(after: newline)...]).trimmingCharacters(in: .newlines)
        }
        return Page(title: title, body: body)
    }
}
