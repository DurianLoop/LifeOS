import Foundation

enum PageKind: String, Codable, CaseIterable { case note, journal }

struct Notebook: Identifiable, Codable, Hashable {
    var id: String = UUID().uuidString
    var name: String
    var symbol: String = "folder"
}

struct Revision: Identifiable, Codable, Equatable {
    var id: String = UUID().uuidString
    var date: Date = Date()
    var title: String
    var body: String
}

struct Attachment: Identifiable, Codable, Equatable {
    var id: String = UUID().uuidString
    var name: String
    var storedName: String
    var bytes: Int
}

struct Page: Identifiable, Codable, Equatable {
    var id: String = UUID().uuidString
    var kind: PageKind = .note
    var title: String = ""
    var body: String = ""
    var journalDate: String? = nil
    var notebookID: String? = nil
    var tags: [String] = []
    var pinned: Bool = false
    var createdAt: Date = Date()
    var updatedAt: Date = Date()
    var deletedAt: Date? = nil
    var revisions: [Revision] = []
    var attachments: [Attachment] = []

    var displayTitle: String { title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? (kind == .journal ? "日记 · \(journalDate ?? "今天")" : "未命名笔记") : title }
    var excerpt: String { String(body.replacingOccurrences(of: #"[#*>`\[\]]"#, with: "", options: .regularExpression).split(whereSeparator: \.isNewline).joined(separator: " ").prefix(120)) }
    var wordCount: Int { body.filter { !$0.isWhitespace }.count }
    var wikiLinks: [String] {
        guard let regex = try? NSRegularExpression(pattern: #"\[\[([^\]\n]+)\]\]"#) else { return [] }
        return regex.matches(in: body, range: NSRange(body.startIndex..., in: body)).compactMap { match in
            Range(match.range(at: 1), in: body).map { String(body[$0]) }
        }
    }
}

struct Workspace: Codable, Equatable {
    var format: Int = 1
    var notebooks: [Notebook] = []
    var pages: [Page] = []
    var migratedSources: [String] = []

    func validate() throws {
        guard format == 1, pages.count <= 20_000,
              Set(pages.map(\.id)).count == pages.count,
              Set(notebooks.map(\.id)).count == notebooks.count,
              pages.allSatisfy({ !$0.id.isEmpty && $0.body.utf8.count <= 8_000_000 && $0.attachments.allSatisfy { $0.storedName == ($0.storedName as NSString).lastPathComponent && !$0.storedName.contains("\\") && ![".", "..", ""].contains($0.storedName) } })
        else { throw LibraryError.invalidArchive }
    }
}

struct Backup: Codable {
    var application = "LifeOS Native"
    var version = 1
    var createdAt = Date()
    var workspace: Workspace
    var files: [String: Data]
}

enum LibraryError: LocalizedError {
    case invalidArchive, corruptStore, tooLarge, unsupported, missingFile(String)
    var errorDescription: String? {
        switch self {
        case .invalidArchive: return "文件格式不完整或包含不安全的路径，请使用有效的 LifeOS 备份。"
        case .corruptStore: return "本地资料库无法读取。已有文件已保留，请先导出文件或从备份恢复。"
        case .tooLarge: return "文件过大。单个附件上限为 25 MB，备份上限为 200 MB。"
        case .unsupported: return "支持 Markdown、TXT、LifeOS JSON 备份和旧版工作区 ZIP。"
        case .missingFile(let name): return "无法读取附件：\(name)。原有资料库已保留。"
        }
    }
}

enum Day {
    static func key(_ date: Date) -> String {
        let f = DateFormatter(); f.calendar = Calendar(identifier: .gregorian); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }
    static func date(_ key: String) -> Date {
        let f = DateFormatter(); f.calendar = Calendar(identifier: .gregorian); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd"
        return f.date(from: key) ?? Date()
    }
}
