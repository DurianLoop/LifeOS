import SwiftUI
import UIKit
import UniformTypeIdentifiers

@MainActor final class LibraryStore: ObservableObject {
    @Published private(set) var workspace = Workspace()
    @Published var error: String?
    @Published var notice: String?
    @Published var importPreview: Backup?
    @Published var importedCount: Int?
    @Published var pendingTrash: TrashUndo?
    private(set) var repository: Repository?
    @Published private(set) var unavailable = false

    init() {
        do {
            let support = try FileManager.default.url(for:.applicationSupportDirectory,in:.userDomainMask,appropriateFor:nil,create:true)
            let test = ProcessInfo.processInfo.arguments.contains("--ui-testing")
            let preferred=UserDefaults.standard.string(forKey:"libraryFolder") ?? "LifeOSNative"
            let valid=preferred=="LifeOSNative" || (preferred.hasPrefix("LifeOSRecovered-") && UUID(uuidString:String(preferred.dropFirst(16))) != nil)
            let root = support.appendingPathComponent(test ? "LifeOSAcceptance" : valid ? preferred : "LifeOSNative",isDirectory:true)
            if test && ProcessInfo.processInfo.arguments.contains("--reset-library") {
                if FileManager.default.fileExists(atPath:root.path){try FileManager.default.removeItem(at:root)}
                for key in ["appearance","serifReading","comfortableReading","recentSearches"]{UserDefaults.standard.removeObject(forKey:key)}
            }
            let repo = try Repository(root:root)
            repository = repo; workspace = repo.workspace; notice = repo.recoveryMessage
            if test && ProcessInfo.processInfo.arguments.contains("--seed-library") && workspace.pages.isEmpty { try seed() }
            if !test && workspace.pages.isEmpty { discoverLegacy(support:support) }
        } catch { self.error = error.localizedDescription; unavailable = true }
    }

    var active: [Page] { workspace.pages.filter { $0.deletedAt == nil }.sorted { $0.updatedAt > $1.updatedAt } }
    var allTags: [String] { Array(Set(active.flatMap(\.tags))).sorted() }
    func page(_ id: String) -> Page? { workspace.pages.first { $0.id == id } }
    func bookName(_ id: String?) -> String { workspace.notebooks.first { $0.id == id }?.name ?? "未分类" }

    @discardableResult func save(_ page: Page) -> Bool {
        guard let repository else { return false }
        do { try repository.save(page); workspace=repository.workspace; return true }
        catch { self.error=error.localizedDescription; return false }
    }
    @discardableResult func change(_ operation: (inout Workspace)->Void) -> Bool {
        guard let repository else { return false }
        do { var updated=workspace;operation(&updated);try repository.commit(updated);workspace=repository.workspace;return true }
        catch { self.error=error.localizedDescription;return false }
    }
    func create(kind:PageKind, date:Date=Date(), notebook:String?=nil) -> Page? {
        if kind == .journal, let existing=active.first(where:{$0.kind == .journal && $0.journalDate == Day.key(date)}) { return existing }
        let page=Page(kind:kind,journalDate:kind == .journal ? Day.key(date) : nil,notebookID:notebook)
        return repository == nil ? nil : page
    }
    @discardableResult func trash(_ page:Page) -> Bool {
        var p=page;p.deletedAt=Date()
        guard save(p) else{return false}
        pendingTrash=TrashUndo(pageID:page.id,title:page.displayTitle)
        UIAccessibility.post(notification:.announcement,argument:"已移到废纸篓，可以轻点撤销。")
        return true
    }
    func undoTrash() {
        guard let pending=pendingTrash, var page=page(pending.pageID), page.deletedAt != nil else{pendingTrash=nil;return}
        page.deletedAt=nil
        if save(page){pendingTrash=nil}
    }
    func restore(_ page:Page) { var p=page;p.deletedAt=nil;if save(p),pendingTrash?.pageID==page.id{pendingTrash=nil} }
    func togglePin(_ page:Page) { var p=page;p.pinned.toggle();_ = save(p) }
    func restoreRevision(_ revision:Revision,page:Page) {
        do { try repository?.restore(revision,for:page.id);workspace=repository?.workspace ?? workspace }
        catch { self.error=error.localizedDescription }
    }
    func addAttachment(url:URL,page:Page) -> Page? {
        let scoped=url.startAccessingSecurityScopedResource();defer{if scoped{url.stopAccessingSecurityScopedResource()}}
        do {
            guard let repository else { return nil }
            let size=try url.resourceValues(forKeys:[.fileSizeKey]).fileSize ?? 0
            guard size<=25_000_000 else{throw LibraryError.tooLarge}
            let updated=try repository.addAttachment(data:Data(contentsOf:url),name:url.lastPathComponent,page:page)
            workspace=repository.workspace;return updated
        } catch { self.error=error.localizedDescription;return nil }
    }
    func attachmentURL(_ item:Attachment) -> URL? { repository?.attachmentsURL.appendingPathComponent(item.storedName) }
    func search(_ query:String,notebook:String?=nil,tag:String?=nil)->[Page] { repository?.search(query,notebook:notebook,tag:tag) ?? [] }
    func backlinks(_ page:Page)->[Page] { active.filter{$0.id != page.id && $0.wikiLinks.contains(page.displayTitle)} }

    func previewImport(_ urls:[URL]) {
        do {
            guard let repository else { return }
            var combined=Backup(workspace:Workspace(),files:[:])
            for url in urls {
                let scoped=url.startAccessingSecurityScopedResource();defer{if scoped{url.stopAccessingSecurityScopedResource()}}
                let size=try url.resourceValues(forKeys:[.fileSizeKey]).fileSize ?? 0
                guard size<=200_000_000 else {throw LibraryError.tooLarge}
                let data=try Data(contentsOf:url)
                let result:Backup
                if url.pathExtension.lowercased()=="zip" {
                    let temp=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString,isDirectory:true)
                    defer{try? FileManager.default.removeItem(at:temp)}
                    result=try LegacyImport.zip(data,temporary:temp)
                } else if ["json","lifeos"].contains(url.pathExtension.lowercased()) { result=try repository.decodeBackup(data) }
                else { result=Backup(workspace:Workspace(pages:[try repository.importMarkdown(data,name:url.lastPathComponent)]),files:[:]) }
                combined.workspace.pages.append(contentsOf:result.workspace.pages)
                for book in result.workspace.notebooks where !combined.workspace.notebooks.contains(where:{$0.id==book.id}) {combined.workspace.notebooks.append(book)}
                combined.files.merge(result.files){old,_ in old}
            }
            try combined.workspace.validate();importPreview=combined
        } catch {self.error=error.localizedDescription}
    }
    func confirmImport() {
        guard let preview=importPreview else{return}
        if unavailable {
            do {
                let support=try FileManager.default.url(for:.applicationSupportDirectory,in:.userDomainMask,appropriateFor:nil,create:true)
                let name="LifeOSRecovered-"+UUID().uuidString
                let restored=try Repository(root:support.appendingPathComponent(name,isDirectory:true))
                let count=try restored.merge(preview)
                UserDefaults.standard.set(name,forKey:"libraryFolder")
                repository=restored;workspace=restored.workspace;unavailable=false;error=nil;importPreview=nil;importedCount=count
                notice="已从备份恢复。之前无法读取的资料库仍保留在设备上。"
            } catch {self.error=error.localizedDescription}
            return
        }
        guard let repository else{return}
        do {let count=try repository.merge(preview);workspace=repository.workspace;importPreview=nil;importedCount=count}
        catch {self.error=error.localizedDescription}
    }
    func previewRecovery(_ url:URL){
        let scoped=url.startAccessingSecurityScopedResource();defer{if scoped{url.stopAccessingSecurityScopedResource()}}
        let temp=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString,isDirectory:true)
        defer{try? FileManager.default.removeItem(at:temp)}
        do {
            let size=try url.resourceValues(forKeys:[.fileSizeKey]).fileSize ?? 0
            guard size<=200_000_000 else{throw LibraryError.tooLarge}
            let bytes=try Data(contentsOf:url)
            if url.pathExtension.lowercased()=="zip"{importPreview=try LegacyImport.zip(bytes,temporary:temp)}
            else{let reader=try Repository(root:temp);importPreview=try reader.decodeBackup(bytes)}
        } catch {self.error=error.localizedDescription}
    }
    private func discoverLegacy(support:URL) {
        let documents=FileManager.default.urls(for:.documentDirectory,in:.userDomainMask).first!
        let candidates=[support.appendingPathComponent("life.lifeos.lifeosmobile/workspace"),support.appendingPathComponent("LifeOS/workspace"),support.appendingPathComponent("workspace"),documents.appendingPathComponent("workspace")]
        for root in candidates where FileManager.default.fileExists(atPath:root.appendingPathComponent(".lifeos/core.db").path) {
            do {importPreview=try LegacyImport.workspace(root);notice="发现旧版日记。预览后即可带入新资料库，原文件会保留。"}
            catch {self.error="旧版资料暂未迁入："+error.localizedDescription}
            break
        }
    }
    private func seed() throws {
        let books=[Notebook(id:"life",name:"生活札记",symbol:"leaf"),Notebook(id:"ideas",name:"想法与阅读",symbol:"book.closed")]
        var pages=[
            Page(id:"slow",title:"给生活留一点空白",body:"## 慢一点，也很好\n\n不必把每一刻都填满。给自己留一段没有安排的下午，去散步、读书，或者只是看看窗外。\n\n> 日子不是清单，而是一次次认真地在场。\n\n- [x] 去河边走一走\n- [ ] 读完书桌上的那本书\n\n想起前几天写下的 [[一些微小的发现]]。",notebookID:"life",tags:["生活","随想"],pinned:true),
            Page(id:"small",title:"一些微小的发现",body:"雨后的空气，第一杯热茶，和刚好照进窗边的一束光。\n\n值得记录的，常常是这些小事。",notebookID:"life",tags:["日常"]),
            Page(id:"reading",title:"读书时，留下一条线索",body:"## 不急着读完\n\n把触动自己的那句话记下来。下次再读，也许会有新的理解。\n\n参考 [[给生活留一点空白]]。",notebookID:"ideas",tags:["阅读"]),
            Page(id:"today",kind:.journal,title:"把今天慢慢写下",body:"早晨把窗打开，听见楼下的鸟叫。\n\n今天想做的事很简单：认真工作，好好吃饭，给自己一点安静的时间。",journalDate:Day.key(Date()),tags:["日常"])
        ]
        pages[0].revisions=[Revision(title:"给生活留一点空白",body:"给自己留一段没有安排的下午。")]
        try repository?.commit(Workspace(notebooks:books,pages:pages));workspace=repository!.workspace
    }
}

struct TrashUndo:Identifiable {
    let id=UUID()
    let date=Date()
    let pageID:String
    let title:String
}

struct ExportDocument:FileDocument {
    static var readableContentTypes:[UTType]{[.json,.plainText]}
    var data:Data
    init(data:Data){self.data=data}
    init(configuration:ReadConfiguration)throws{data=configuration.file.regularFileContents ?? Data()}
    func fileWrapper(configuration:WriteConfiguration)throws->FileWrapper{FileWrapper(regularFileWithContents:data)}
}
