import SwiftUI
import UIKit
import UniformTypeIdentifiers

struct PageEditor:View {
    @EnvironmentObject private var store:LibraryStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scene
    @State private var page:Page
    @State private var saved:Page
    @State private var properties=false
    @State private var attach=false
    @State private var failure=false
    @State private var saving=false
    @State private var attachmentError:String?
    init(initial:Page){_page=State(initialValue:initial);_saved=State(initialValue:initial)}
    var body:some View {
        NavigationStack {
            VStack(alignment:.leading,spacing:0){
                HStack(spacing:7){
                    Image(systemName:page.kind == .journal ? "sun.horizon" : "doc.text")
                    Text(page.kind == .journal ? page.journalDate ?? "日记" : store.bookName(page.notebookID))
                    Spacer()
                    if saving{ProgressView().controlSize(.mini)}
                    Text(failure ? "保存失败 · 点此重试" : page == saved ? "已保存" : "正在保存…")
                        .foregroundStyle(failure ? .red : .secondary).onTapGesture{persist()}.accessibilityIdentifier("editor.status")
                }.font(.caption).foregroundStyle(.secondary).padding(.horizontal,25).padding(.top,20).padding(.bottom,16)
                TextField("给这一页起个名字",text:$page.title,axis:.vertical).font(.system(.title,design:.default).weight(.semibold)).textFieldStyle(.plain).padding(.horizontal,25).padding(.bottom,19).accessibilityIdentifier("editor.title")
                if !page.tags.isEmpty{FlowTags(tags:page.tags).padding(.horizontal,25).padding(.bottom,14)}
                Divider().padding(.horizontal,25)
                NativeMarkdownEditor(text:$page.body)
                if !page.attachments.isEmpty {
                    ScrollView(.horizontal,showsIndicators:false){HStack{ForEach(page.attachments){item in Label(item.name,systemImage:"paperclip").font(.caption).padding(10).background(Paper.background,in:Capsule())}}.padding(.horizontal,20)}.frame(maxHeight:55)
                }
                if failure{Label("文字仍保留在编辑器中，请重试保存后再离开。",systemImage:"exclamationmark.circle").font(.caption).foregroundStyle(.red).padding(14)}
                if let attachmentError{Text(attachmentError).font(.caption).foregroundStyle(.red).padding(14)}
            }.background(Paper.surface).navigationTitle(page.kind == .journal ? "写日记" : "写笔记").navigationBarTitleDisplayMode(.inline)
                .toolbar{
                    ToolbarItem(placement:.cancellationAction){Button("完成"){if persist(){dismiss()}}.fontWeight(.medium).accessibilityIdentifier("editor.done")}
                    ToolbarItemGroup(placement:.topBarTrailing){
                        Button{properties=true}label:{Image(systemName:"tag")}.accessibilityLabel("笔记属性").accessibilityIdentifier("editor.properties")
                        Button{attach=true}label:{Image(systemName:"paperclip")}.accessibilityLabel("添加附件")
                    }
                }
                .interactiveDismissDisabled(page != saved || failure)
                .task(id:page){
                    guard page != saved else{return}
                    do{try await Task.sleep(for:.milliseconds(550))}catch{return}
                    if !Task.isCancelled{persist()}
                }
                .onChange(of:scene){_,value in if value != .active{persist()}}
                .onDisappear{persist()}
                .sheet(isPresented:$properties){PropertiesView(page:$page)}
                .fileImporter(isPresented:$attach,allowedContentTypes:[.item],allowsMultipleSelection:true){result in
                    switch result {
                    case .success(let urls):
                        for url in urls {if let updated=store.addAttachment(url:url,page:page){page=updated;saved=updated;attachmentError=nil}else{attachmentError=store.error ?? "附件未添加，请重试。"}}
                    case .failure(let error):attachmentError=error.localizedDescription
                    }
                }
        }
    }
    @discardableResult private func persist()->Bool{
        guard page != saved else{return !failure}
        saving=true
        let result=store.save(page)
        if result{if let current=store.page(page.id){page=current;saved=current};failure=false}else{failure=true}
        saving=false;return result
    }
}

struct PropertiesView:View {
    @EnvironmentObject private var store:LibraryStore
    @Environment(\.dismiss) private var dismiss
    @Binding var page:Page
    @State private var tags=""
    var body:some View {
        NavigationStack {
            Form {
                Section("归档"){
                    Picker("笔记本",selection:Binding(get:{page.notebookID ?? ""},set:{page.notebookID=$0.isEmpty ? nil : $0})){
                        Text("未分类").tag("");ForEach(store.workspace.notebooks){book in Text(book.name).tag(book.id)}
                    }
                    Toggle("置顶",isOn:$page.pinned)
                }
                Section{TextField("生活, 阅读, 灵感",text:$tags).autocorrectionDisabled().textInputAutocapitalization(.never).accessibilityIdentifier("properties.tags")}header:{Text("标签")}footer:{Text("用逗号分隔。用 [[笔记标题]] 可以在正文中关联另一页。")}
            }.navigationTitle("笔记属性").navigationBarTitleDisplayMode(.inline).onAppear{tags=page.tags.joined(separator:", ")}
                .toolbar{ToolbarItem(placement:.confirmationAction){Button("完成"){page.tags=Array(Set(tags.components(separatedBy:CharacterSet(charactersIn:",，#\n")).map{$0.trimmingCharacters(in:.whitespacesAndNewlines)}.filter{!$0.isEmpty})).sorted();dismiss()}.accessibilityIdentifier("properties.done")}}
        }.presentationDetents([.medium,.large])
    }
}

struct NativeMarkdownEditor:UIViewRepresentable {
    @Binding var text:String
    func makeCoordinator()->Coordinator{Coordinator(self)}
    func makeUIView(context:Context)->UITextView{
        let view=UITextView()
        view.delegate=context.coordinator
        view.backgroundColor = .clear
        view.font = .preferredFont(forTextStyle:.body)
        view.adjustsFontForContentSizeCategory=true
        view.textColor = .label
        view.tintColor = UIColor(named:"Evergreen") ?? .systemGreen
        view.textContainerInset=UIEdgeInsets(top:23,left:20,bottom:50,right:20)
        view.textContainer.lineFragmentPadding=5
        view.keyboardDismissMode = .interactive
        view.alwaysBounceVertical=true
        view.accessibilityLabel="正文，支持 Markdown"
        view.accessibilityIdentifier="editor.body"
        view.smartQuotesType = .no
        view.smartDashesType = .no
        context.coordinator.view=view
        let toolbar=UIToolbar();toolbar.sizeToFit()
        let items:[(String,String,Selector)]=[
            ("textformat.size","标题",#selector(Coordinator.heading)),
            ("bold","加粗",#selector(Coordinator.bold)),
            ("checklist","待办事项",#selector(Coordinator.checklist)),
            ("link","关联笔记",#selector(Coordinator.link))
        ]
        toolbar.items=items.map{symbol,label,action in let item=UIBarButtonItem(image:UIImage(systemName:symbol),style:.plain,target:context.coordinator,action:action);item.accessibilityLabel=label;return item}
        toolbar.items?.append(UIBarButtonItem(systemItem:.flexibleSpace))
        let close=UIBarButtonItem(image:UIImage(systemName:"keyboard.chevron.compact.down"),style:.plain,target:context.coordinator,action:#selector(Coordinator.endEditing));close.accessibilityLabel="收起键盘";toolbar.items?.append(close)
        view.inputAccessoryView=toolbar
        return view
    }
    func updateUIView(_ view:UITextView,context:Context){
        context.coordinator.parent=self
        if view.text != text && view.markedTextRange == nil {let selection=view.selectedRange;view.text=text;view.selectedRange=NSRange(location:min(selection.location,(text as NSString).length),length:0)}
    }
    final class Coordinator:NSObject,UITextViewDelegate {
        var parent:NativeMarkdownEditor
        weak var view:UITextView?
        init(_ parent:NativeMarkdownEditor){self.parent=parent}
        func textViewDidChange(_ textView:UITextView){parent.text=textView.text}
        func insert(_ prefix:String,_ suffix:String="",placeholder:String=""){
            guard let view else{return}
            let selection=view.selectedRange
            let old=view.text as NSString
            let selected=selection.length>0 ? old.substring(with:selection) : placeholder
            let replacement=prefix+selected+suffix
            guard let start=view.position(from:view.beginningOfDocument,offset:selection.location),let end=view.position(from:start,offset:selection.length),let range=view.textRange(from:start,to:end)else{return}
            view.replace(range,withText:replacement)
            view.selectedRange=NSRange(location:selection.location+(prefix as NSString).length,length:(selected as NSString).length)
            parent.text=view.text
        }
        @objc func heading(){insert("\n## ")}
        @objc func bold(){insert("**","**",placeholder:"加粗文字")}
        @objc func checklist(){insert("\n- [ ] ")}
        @objc func link(){insert("[[","]]",placeholder:"笔记标题")}
        @objc func endEditing(){view?.resignFirstResponder()}
    }
}
