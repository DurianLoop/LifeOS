import SwiftUI
import UniformTypeIdentifiers

struct LibraryView:View {
    @EnvironmentObject private var store:LibraryStore
    @State private var newBook=false
    @State private var bookName=""
    @State private var renaming:Notebook?
    @State private var removing:Notebook?
    let open:(Page)->Void
    var body:some View {
        NavigationStack {
            List {
                Section {
                    HStack(spacing:18){Image(systemName:"books.vertical").font(.system(size:32,weight:.ultraLight)).foregroundStyle(Paper.accent);VStack(alignment:.leading,spacing:7){Text("你的私人资料库").font(.headline);Text("\(store.active.count) 篇笔记 · \(store.workspace.notebooks.count) 本笔记本").font(.subheadline).foregroundStyle(.secondary)}}.padding(.vertical,12)
                }
                Section {
                    ForEach(store.workspace.notebooks){book in
                        NavigationLink{PageCollection(title:book.name,notebook:book.id,open:open)}label:{Label(book.name,systemImage:book.symbol)}
                            .contextMenu{
                                Button("重命名",systemImage:"pencil"){bookName=book.name;renaming=book;newBook=true}
                                Button("移除笔记本",systemImage:"folder.badge.minus",role:.destructive){removing=book}
                            }
                    }
                    Button{renaming=nil;bookName="";newBook=true}label:{Label("新建笔记本",systemImage:"plus")}.accessibilityIdentifier("library.addNotebook")
                }header:{Text("笔记本")}footer:{Text("笔记只属于一个笔记本，也可以用多个标签串联。")}
                if !store.allTags.isEmpty {Section("标签"){ForEach(store.allTags,id:\.self){tag in NavigationLink{PageCollection(title:"#"+tag,tag:tag,open:open)}label:{Label(tag,systemImage:"number")}}}}
                Section {
                    NavigationLink{TrashView()}label:{Label("废纸篓",systemImage:"trash")}.accessibilityIdentifier("library.trash")
                    NavigationLink{TransferView()}label:{Label("导入与备份",systemImage:"arrow.up.arrow.down")}
                    NavigationLink{SettingsView()}label:{Label("外观与阅读",systemImage:"textformat.size")}.accessibilityIdentifier("library.settings")
                }
                Section {VStack(alignment:.leading,spacing:8){Text("以自己的节奏积累。").font(.system(.title3,design:.serif));Text("本地保存 · 无需账号 · 不自动上传").font(.caption).foregroundStyle(.secondary)}.padding(.vertical,10).listRowBackground(Color.clear)}
            }
            .scrollContentBackground(.hidden).background(Paper.background).navigationTitle("资料库")
            .alert(renaming == nil ? "新建笔记本" : "重命名",isPresented:$newBook){
                TextField("笔记本名称",text:$bookName)
                Button("取消",role:.cancel){renaming=nil}
                Button(renaming == nil ? "创建" : "保存"){
                    let name=String(bookName.trimmingCharacters(in:.whitespacesAndNewlines).prefix(60))
                    if !name.isEmpty {
                        if let book=renaming {
                            _ = store.change{state in if let index=state.notebooks.firstIndex(where:{$0.id==book.id}){state.notebooks[index].name=name}}
                        } else {_ = store.change{$0.notebooks.append(Notebook(name:name))}}
                    }
                    renaming=nil
                }
            }
            .confirmationDialog("移除这个笔记本？",isPresented:Binding(get:{removing != nil},set:{if !$0{removing=nil}}),titleVisibility:.visible){
                Button("移除笔记本",role:.destructive){
                    if let book=removing {
                        _ = store.change{state in state.notebooks.removeAll{$0.id==book.id};for index in state.pages.indices where state.pages[index].notebookID==book.id{state.pages[index].notebookID=nil}}
                    }
                    removing=nil
                }
            }message:{Text("其中的笔记会保留，移到“未分类”。")}
        }
    }
}

struct SettingsView:View {
    @AppStorage("appearance") private var appearance="system"
    @AppStorage("serifReading") private var serif=true
    @AppStorage("comfortableReading") private var comfortable=true
    var body:some View {
        Form {
            Section("外观") {Picker("显示模式",selection:$appearance){Text("跟随系统").tag("system");Text("浅色").tag("light");Text("深色").tag("dark")}.pickerStyle(.menu).accessibilityIdentifier("settings.appearance")}
            Section {Toggle("衬线字体",isOn:$serif);Toggle("舒展的行距",isOn:$comfortable)}header:{Text("阅读")}footer:{Text("字号随 iPhone 的系统文字大小调整，也支持辅助功能中的更大字体。")}
            Section("界面材质"){Label("Liquid Glass",systemImage:"circle.lefthalf.filled");Text("iOS 26 的导航与操作控件使用系统玻璃材质。较早系统使用原生半透明材质；开启“减少透明度”后自动提高不透明度。").font(.footnote).foregroundStyle(.secondary)}
            Section{NavigationLink("导入与备份"){TransferView()}}
            Section("关于 LifeOS"){LabeledContent("版本",value:"0.7.0 · iOS 重构");Text("一个安静的地方，用来写下生活、安放想法。\n\n日记与附件保存在本机。请定期导出完整备份，卸载应用会移除设备上的数据。").font(.footnote).foregroundStyle(.secondary).lineSpacing(5)}
        }.scrollContentBackground(.hidden).background(Paper.background).navigationTitle("外观与阅读").navigationBarTitleDisplayMode(.inline)
    }
}

struct TrashView:View {
    @EnvironmentObject private var store:LibraryStore
    var body:some View {
        List {
            let pages=store.workspace.pages.filter{$0.deletedAt != nil}.sorted{$0.deletedAt! > $1.deletedAt!}
            if pages.isEmpty{EmptyPaper(symbol:"trash",title:"废纸篓是空的",message:"删除的笔记会留在这里，\n需要时可以恢复。") .listRowBackground(Color.clear).listRowSeparator(.hidden)}
            ForEach(pages){page in VStack(alignment:.leading,spacing:9){PageRow(page:page);Button("恢复笔记",systemImage:"arrow.uturn.backward"){store.restore(page)}.accessibilityIdentifier("trash.restore."+page.id)}.padding(.bottom,12)}
        }.navigationTitle("废纸篓").listStyle(.plain).scrollContentBackground(.hidden).background(Paper.background)
    }
}

struct TransferView:View {
    @EnvironmentObject private var store:LibraryStore
    @State private var importing=false
    @State private var exporting=false
    @State private var document:ExportDocument?
    @State private var working=false
    var body:some View {
        Form {
            Section {
                Button{importing=true}label:{Label("从文件导入",systemImage:"square.and.arrow.down")}.accessibilityIdentifier("transfer.import")
            }header:{Text("把旧的文字带来")}footer:{Text("支持 Markdown、TXT、新版 LifeOS JSON 完整备份，以及旧版 LifeOS 工作区 ZIP。导入前会显示预览，已有笔记不会被覆盖。")}
            Section {
                Button{exportBackup()}label:{HStack{Label("导出完整备份",systemImage:"externaldrive");Spacer();if working{ProgressView()}}}.disabled(working).accessibilityIdentifier("transfer.export")
            }header:{Text("为资料留一份副本")}footer:{Text("备份包含笔记、笔记本、标签、历史版本、废纸篓和附件。请存入“文件”或你信任的位置；备份文件未额外加密，请自行妥善保管。")}
            Section("关于同步"){Text("资料保存在这台设备。当前版本暂不自动同步到其他设备；可通过完整备份迁移。若开启系统设备备份，数据由你的系统备份设置管理。").font(.subheadline).foregroundStyle(.secondary).lineSpacing(4)}
        }.scrollContentBackground(.hidden).background(Paper.background).navigationTitle("导入与备份").navigationBarTitleDisplayMode(.inline)
            .fileImporter(isPresented:$importing,allowedContentTypes:[.plainText,.json,.zip,UTType(filenameExtension:"md") ?? .plainText],allowsMultipleSelection:true){result in
                switch result{case .success(let urls):store.previewImport(urls);case .failure(let error):store.error=error.localizedDescription}
            }
            .fileExporter(isPresented:$exporting,document:document,contentType:.json,defaultFilename:"LifeOS-\(Day.key(Date()))-backup"){result in if case .failure(let error)=result{store.error=error.localizedDescription}}
    }
    private func exportBackup(){
        working=true
        do {if let bytes=try store.repository?.backupData(){document=ExportDocument(data:bytes);exporting=true}}
        catch {store.error=error.localizedDescription}
        working=false
    }
}

struct ImportPreviewView:View {
    @EnvironmentObject private var store:LibraryStore
    @Environment(\.dismiss) private var dismiss
    var body:some View {
        NavigationStack {
            List {
                if let preview=store.importPreview{
                    Section{VStack(alignment:.leading,spacing:12){Image(systemName:"tray.and.arrow.down").font(.largeTitle).foregroundStyle(Paper.accent);Text("让这些文字，\n在这里继续。").font(.system(.title,design:.serif));Text("\(preview.workspace.pages.count) 篇笔记 · \(preview.workspace.pages.flatMap(\.attachments).count) 个附件").font(.subheadline).foregroundStyle(.secondary)}.padding(.vertical,20)}
                    Section("即将导入"){ForEach(preview.workspace.pages.prefix(30)){page in PageRow(page:page)}}
                    Section{Text("已有内容会保留。相同内容会跳过；同一标识但内容不同的笔记会另存为副本。旧工作区原件保持可用。").font(.footnote).foregroundStyle(.secondary)}
                }
            }.navigationTitle("导入预览").navigationBarTitleDisplayMode(.inline)
                .toolbar{ToolbarItem(placement:.cancellationAction){Button("取消"){store.importPreview=nil;dismiss()}};ToolbarItem(placement:.confirmationAction){Button("确认导入"){store.confirmImport()}.fontWeight(.semibold).accessibilityIdentifier("import.confirm")}}
        }
    }
}
