import SwiftUI
import UniformTypeIdentifiers

@main struct LifeOSApp:App {
    @StateObject private var store=LibraryStore()
    @AppStorage("appearance") private var appearance="system"
    var body:some Scene {
        WindowGroup {
            RootView().environmentObject(store).tint(Paper.accent)
                .preferredColorScheme(appearance == "dark" ? .dark : appearance == "light" ? .light : nil)
        }
    }
}

enum Destination:Hashable {case notes,journal,search,library}
struct RootView:View {
    @EnvironmentObject private var store:LibraryStore
    @State private var tab:Destination = .notes
    @State private var selected:Page?
    @State private var editor:Page?
    @State private var recoveryImport=false
    var body:some View {
        Group {
            if store.unavailable {
                EmptyPaper(symbol:"externaldrive.badge.exclamationmark",title:"资料库需要恢复",message:store.error ?? "原有文件已保留，请从设备备份恢复后重试。",action:"从完整备份恢复"){recoveryImport=true}
            } else {
                TabView(selection:$tab){
                    NotesView(open:{selected=$0},create:{if let p=store.create(kind:.note){editor=p}}).tabItem{Label("笔记",systemImage:"doc.text")}.tag(Destination.notes)
                    JournalView(open:{selected=$0},edit:{editor=$0}).tabItem{Label("日记",systemImage:"book.closed")}.tag(Destination.journal)
                    SearchView(open:{selected=$0}).tabItem{Label("搜索",systemImage:"magnifyingglass")}.tag(Destination.search)
                    LibraryView(open:{selected=$0}).tabItem{Label("资料库",systemImage:"square.stack.3d.up")}.tag(Destination.library)
                }
            }
        }
        .sheet(item:$selected){PageDetail(pageID:$0.id)}
        .fileImporter(isPresented:$recoveryImport,allowedContentTypes:[.json,.zip],allowsMultipleSelection:false){result in
            switch result{case .success(let urls):if let url=urls.first{store.previewRecovery(url)};case .failure(let error):store.error=error.localizedDescription}
        }
        .sheet(item:$editor){PageEditor(initial:$0)}
        .sheet(isPresented:Binding(get:{store.importPreview != nil},set:{if !$0{store.importPreview=nil}})){ImportPreviewView()}
        .alert("暂未完成",isPresented:Binding(get:{store.error != nil && !store.unavailable},set:{if !$0{store.error=nil}})){Button("知道了"){store.error=nil}}message:{Text(store.error ?? "")}
        .alert("已带入资料库",isPresented:Binding(get:{store.importedCount != nil},set:{if !$0{store.importedCount=nil}})){Button("好"){store.importedCount=nil}}message:{Text("已导入 \(store.importedCount ?? 0) 篇笔记。原有内容保留。")}
    }
}
