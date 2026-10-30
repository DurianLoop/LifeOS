import SwiftUI
import UniformTypeIdentifiers

struct LibraryView:View {
    @EnvironmentObject private var store:LibraryStore
    @State private var newBook=false
    @State private var bookName=""
    @State private var renaming:Notebook?
    @State private var removing:Notebook?
    var body:some View {
        NavigationStack {
            List {
                Section {
                    Text("\(store.active.count) 篇笔记 · \(store.workspace.notebooks.count) 本笔记本").font(.subheadline).foregroundStyle(.secondary).accessibilityIdentifier("library.count")
                }.listRowBackground(Color.clear)
                Section {
                    ForEach(store.workspace.notebooks){book in
                        NavigationLink{PageCollection(title:book.name,notebook:book.id)}label:{Label(book.name,systemImage:book.symbol)}
                            .contextMenu{
                                Button("重命名",systemImage:"pencil"){bookName=book.name;renaming=book;newBook=true}
                                Button("移除笔记本",systemImage:"folder.badge.minus",role:.destructive){removing=book}
                            }
                    }
                    Button{renaming=nil;bookName="";newBook=true}label:{Label("新建笔记本",systemImage:"plus")}.accessibilityIdentifier("library.addNotebook")
                }header:{Text("笔记本")}
                if !store.allTags.isEmpty {Section("标签"){ForEach(store.allTags,id:\.self){tag in NavigationLink{PageCollection(title:"#"+tag,tag:tag)}label:{Label(tag,systemImage:"number")}}}}
                Section {
                    NavigationLink{TrashView()}label:{Label("废纸篓",systemImage:"trash")}.accessibilityIdentifier("library.trash")
                    NavigationLink{TransferView()}label:{Label("导入与备份",systemImage:"arrow.up.arrow.down")}
                    NavigationLink{SettingsView()}label:{Label("外观与阅读",systemImage:"textformat.size")}.accessibilityIdentifier("library.settings")
                }
            }
            .scrollContentBackground(.hidden).background(Paper.background).navigationTitle("资料库").navigationBarTitleDisplayMode(.inline).trashFeedback()
            .alert(renaming == nil ? "新建笔记本" : "重命名",isPresented:$newBook){
                TextField("",text:$bookName).accessibilityLabel("笔记本名称")
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
            Section{NavigationLink("导入与备份"){TransferView()}}
            Section("关于 LifeOS"){LabeledContent("版本",value:"0.7.2");Text("资料保存在本机。卸载前请导出完整备份。").font(.footnote).foregroundStyle(.secondary)}
        }.scrollContentBackground(.hidden).background(Paper.background).navigationTitle("外观与阅读").navigationBarTitleDisplayMode(.inline)
    }
}

struct TrashView:View {
    @EnvironmentObject private var store:LibraryStore
    var body:some View {
        List {
            let pages=store.workspace.pages.filter{$0.deletedAt != nil}.sorted{$0.deletedAt! > $1.deletedAt!}
            if pages.isEmpty{EmptyPaper(title:"废纸篓为空").listRowBackground(Color.clear).listRowSeparator(.hidden)}
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
            }header:{Text("导入")}footer:{Text("支持 Markdown、TXT、LifeOS 完整备份和旧版工作区 ZIP。导入前可预览，已有笔记保留。")}
            Section {
                Button{exportBackup()}label:{HStack{Label("导出完整备份",systemImage:"externaldrive");Spacer();if working{ProgressView()}}}.disabled(working).accessibilityIdentifier("transfer.export")
            }header:{Text("备份")}footer:{Text("包含笔记、历史版本、废纸篓和附件。备份文件未加密，请妥善保存。")}
            Section{Text("当前不自动跨设备同步，可通过完整备份迁移。").font(.footnote).foregroundStyle(.secondary)}
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
                    Section{Text("\(preview.workspace.pages.count) 篇笔记 · \(preview.workspace.pages.flatMap(\.attachments).count) 个附件").font(.subheadline).foregroundStyle(.secondary)}
                    Section("即将导入"){ForEach(preview.workspace.pages.prefix(30)){page in PageRow(page:page)}}
                    Section{Text("已有内容会保留。相同内容会跳过；同一标识但内容不同的笔记会另存为副本。旧工作区原件保持可用。").font(.footnote).foregroundStyle(.secondary)}
                }
            }.navigationTitle("导入预览").navigationBarTitleDisplayMode(.inline)
                .toolbar{ToolbarItem(placement:.cancellationAction){Button("取消"){store.importPreview=nil;dismiss()}};ToolbarItem(placement:.confirmationAction){Button("确认导入"){store.confirmImport()}.fontWeight(.semibold).accessibilityIdentifier("import.confirm")}}
        }
    }
}
