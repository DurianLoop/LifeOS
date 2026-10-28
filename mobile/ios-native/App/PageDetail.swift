import SwiftUI
import UniformTypeIdentifiers
import QuickLook

struct PageDetail:View {
    @EnvironmentObject private var store:LibraryStore
    @Environment(\.dismiss) private var dismiss
    @AppStorage("serifReading") private var serif=true
    @AppStorage("comfortableReading") private var comfortable=true
    @State private var editor:Page?
    @State private var history=false
    @State private var trashConfirmation=false
    @State private var export=false
    @State private var document:ExportDocument?
    @State private var attachment:URL?
    private struct LinkedPage:Hashable{let id:String}
    @State private var linked:LinkedPage?
    @State private var missingLink:String?
    let pageID:String
    private var page:Page?{store.page(pageID)}
    var body:some View {
        Group {
            Group {
                if let page {
                    ScrollView {
                        VStack(alignment:.leading,spacing:23){
                            HStack(spacing:8){Image(systemName:page.kind == .journal ? "sun.horizon" : "doc.text");Text(page.kind == .journal ? page.journalDate ?? "日记" : store.bookName(page.notebookID))}.font(.subheadline).foregroundStyle(Paper.accent).padding(.top,16)
                            Text(page.displayTitle).font(.system(.largeTitle,design:serif ? .serif : .default).weight(.semibold)).fixedSize(horizontal:false,vertical:true).accessibilityIdentifier("reader.title")
                            HStack{Text(page.updatedAt,format:.dateTime.month().day().hour().minute());Text("·");Text("\(page.wordCount) 字")}.font(.caption).foregroundStyle(.secondary)
                            if !page.tags.isEmpty{FlowTags(tags:page.tags)}
                            Divider()
                            if page.body.isEmpty{Text("这一页还留着空白。轻点编辑，开始写下第一句。").font(.body).foregroundStyle(.secondary).padding(.vertical,24)}
                            else {MarkdownBody(body:page.body,serif:serif,spacing:comfortable ? 11 : 5,onToggle:{line in toggleTask(line,page:page)})}
                            if !page.attachments.isEmpty {
                                SectionCaption(title:"附件",trailing:"\(page.attachments.count)")
                                ForEach(page.attachments){item in Button{attachment=store.attachmentURL(item)}label:{HStack(spacing:12){Image(systemName:"paperclip");VStack(alignment:.leading,spacing:4){Text(item.name).lineLimit(2);Text(ByteCountFormatter.string(fromByteCount:Int64(item.bytes),countStyle:.file)).font(.caption).foregroundStyle(.secondary)};Spacer();Image(systemName:"arrow.up.right")}.padding(15).background(Paper.background,in:RoundedRectangle(cornerRadius:14))}.buttonStyle(.plain)}
                            }
                            let backlinks=store.backlinks(page)
                            if !backlinks.isEmpty {
                                Divider().padding(.top,18);SectionCaption(title:"提到这一页",trailing:"\(backlinks.count) 条关联")
                                ForEach(backlinks){item in Button{linked=LinkedPage(id:item.id)}label:{Label(item.displayTitle,systemImage:"link").font(.subheadline).padding(.vertical,6)} }
                            }
                            Text("保存在本机").font(.caption2).foregroundStyle(.tertiary).frame(maxWidth:.infinity).padding(.vertical,36)
                        }.padding(.horizontal,27).frame(maxWidth:710).frame(maxWidth:.infinity)
                    }.background(Paper.surface)
                } else {EmptyPaper(symbol:"doc",title:"这一页暂不可用",message:"返回资料库，再试一次。")}
            }
            .navigationTitle("阅读").navigationBarTitleDisplayMode(.inline)
            .toolbar{
                ToolbarItemGroup(placement:.topBarTrailing){
                    if let page{
                        Button{editor=page}label:{Image(systemName:"square.and.pencil")}.accessibilityLabel("编辑笔记").accessibilityIdentifier("reader.edit")
                        Menu{
                            Button(page.pinned ? "取消置顶" : "置顶",systemImage:"pin"){store.togglePin(page)}
                            Button("历史版本",systemImage:"clock.arrow.circlepath"){history=true}
                            Button("导出 Markdown",systemImage:"square.and.arrow.up"){if let text=store.repository?.markdown(page){document=ExportDocument(data:Data(text.utf8));export=true}}
                            Divider();Button("移到废纸篓",systemImage:"trash",role:.destructive){trashConfirmation=true}
                        }label:{Image(systemName:"ellipsis")}.accessibilityLabel("笔记菜单").accessibilityIdentifier("reader.menu")
                    }
                }
            }
            .sheet(item:$editor){PageEditor(initial:$0)}
            .sheet(isPresented:$history){if let page{HistoryView(page:page)}}
            .navigationDestination(item:$linked){PageDetail(pageID:$0.id)}
            .quickLookPreview($attachment)
            .fileExporter(isPresented:$export,document:document,contentType:.plainText,defaultFilename:(page?.displayTitle ?? "LifeOS")+".md"){result in if case .failure(let error)=result{store.error=error.localizedDescription}}
            .confirmationDialog("将这一页移到废纸篓？",isPresented:$trashConfirmation,titleVisibility:.visible){Button("移到废纸篓",role:.destructive){if let page,store.trash(page){dismiss()}}}message:{Text("可以随时在资料库的废纸篓中恢复。")}
            .alert("这条线索还没有页面",isPresented:Binding(get:{missingLink != nil},set:{if !$0{missingLink=nil}})){
                Button("取消",role:.cancel){missingLink=nil}
                Button("新建关联笔记"){
                    if let title=missingLink{let new=Page(title:title);if store.save(new){editor=new}}
                    missingLink=nil
                }
            }message:{Text("创建“\(missingLink ?? "")”，继续写下去。")}
            .environment(\.openURL,OpenURLAction{url in
                if url.scheme=="lifeos",let components=URLComponents(url:url,resolvingAgainstBaseURL:false),let title=components.queryItems?.first(where:{$0.name=="title"})?.value {
                    if let match=store.active.first(where:{$0.displayTitle==title}){linked=LinkedPage(id:match.id)}else{missingLink=title};return .handled
                }
                return .systemAction
            })
        }
    }
    private func toggleTask(_ line:Int,page:Page){
        var copy=page
        copy.body=Markdown.toggleVisibleTask(page.body,line:line)
        _ = store.save(copy)
    }
}

struct MarkdownBody:View {
    let source:String
    var serif=false
    var spacing:CGFloat=9
    var onToggle:((Int)->Void)?=nil
    init(body:String,serif:Bool=false,spacing:CGFloat=9,onToggle:((Int)->Void)?=nil){self.source=body;self.serif=serif;self.spacing=spacing;self.onToggle=onToggle}
    private var blocks:[Markdown.Block]{Markdown.blocks(source)}
    var bodyView:some View {
        VStack(alignment:.leading,spacing:spacing){ForEach(blocks){block in
            let line=block.text
            if block.kind == .code {
                VStack(alignment:.leading,spacing:12){
                    if !block.language.isEmpty{Text(block.language.uppercased()).font(.caption2.weight(.medium)).foregroundStyle(.secondary)}
                    ScrollView(.horizontal){Text(block.text).font(.system(.callout,design:.monospaced)).fixedSize(horizontal:true,vertical:false).textSelection(.enabled).padding(.bottom,4)}
                }.padding(17).background(Paper.background,in:RoundedRectangle(cornerRadius:13)).overlay(RoundedRectangle(cornerRadius:13).stroke(Paper.line))
            }
            else if block.kind == .divider {Divider().padding(.vertical,12)}
            else if line.isEmpty{Color.clear.frame(height:6).accessibilityHidden(true)}
            else if line.hasPrefix("- [ ] ") || line.hasPrefix("- [x] ") {
                let checked=line.hasPrefix("- [x] ")
                HStack(alignment:.top,spacing:11){Button{onToggle?(block.id)}label:{Image(systemName:checked ? "checkmark.square.fill" : "square").foregroundStyle(checked ? Paper.accent : .secondary).frame(minWidth:28,minHeight:28)}.disabled(onToggle==nil).accessibilityLabel(checked ? "标为未完成" : "标为已完成");inline(String(line.dropFirst(6))).strikethrough(checked).foregroundStyle(checked ? .secondary : .primary)}
            } else if line.hasPrefix("### "){inline(String(line.dropFirst(4))).font(.headline).padding(.top,10)}
            else if line.hasPrefix("## "){inline(String(line.dropFirst(3))).font(.system(.title3,design:serif ? .serif : .default).weight(.semibold)).padding(.top,14)}
            else if line.hasPrefix("# "){inline(String(line.dropFirst(2))).font(.system(.title2,design:serif ? .serif : .default).weight(.semibold)).padding(.top,14)}
            else if line.hasPrefix("> "){HStack(alignment:.top,spacing:14){Rectangle().fill(Paper.accent.opacity(0.4)).frame(width:3);inline(String(line.dropFirst(2))).foregroundStyle(.secondary)}.fixedSize(horizontal:false,vertical:true).padding(.vertical,9)}
            else if line.hasPrefix("- ") || line.hasPrefix("* "){HStack(alignment:.top,spacing:12){Text("•").foregroundStyle(Paper.accent);inline(String(line.dropFirst(2)))}}
            else if let range=line.range(of:#"^\d+\.\s+"#,options:.regularExpression){HStack(alignment:.top,spacing:12){Text(String(line[range]).trimmingCharacters(in:.whitespaces)).foregroundStyle(Paper.accent);inline(String(line[range.upperBound...]))}}
            else {inline(line)}
        }}.font(.system(.body,design:serif ? .serif : .default)).lineSpacing(spacing/2).frame(maxWidth:.infinity,alignment:.leading).textSelection(.enabled)
    }
    var body:some View {bodyView}
    private func inline(_ text:String)->Text {
        let markdown=Markdown.inlineLinks(text)
        return Text((try? AttributedString(markdown:markdown,options:.init(interpretedSyntax:.inlineOnlyPreservingWhitespace))) ?? AttributedString(text))
    }
}

struct FlowTags:View {
    let tags:[String]
    var body:some View {ScrollView(.horizontal,showsIndicators:false){HStack(spacing:8){ForEach(tags,id:\.self){tag in Text("#"+tag).font(.caption).foregroundStyle(Paper.accent).padding(.horizontal,10).padding(.vertical,6).background(Paper.accent.opacity(0.07),in:Capsule())}}}}
}

struct HistoryView:View {
    @EnvironmentObject private var store:LibraryStore
    @Environment(\.dismiss) private var dismiss
    @State private var selected:Revision?
    let page:Page
    var body:some View {
        NavigationStack {
            List {
                if page.revisions.isEmpty{EmptyPaper(symbol:"clock.arrow.circlepath",title:"还没有历史版本",message:"继续写作后，修改前的内容会在这里留存。\n连续输入会合并为约五分钟一次的版本。") .listRowBackground(Color.clear)}
                ForEach(page.revisions.reversed()){revision in Button{selected=revision}label:{VStack(alignment:.leading,spacing:8){Text(revision.date,format:.dateTime.month().day().hour().minute()).font(.subheadline.weight(.medium));Text(revision.body).font(.subheadline).foregroundStyle(.secondary).lineLimit(3)}.padding(.vertical,8)}.buttonStyle(.plain)}
            }.scrollContentBackground(.hidden).background(Paper.background).navigationTitle("历史版本").navigationBarTitleDisplayMode(.inline).toolbar{ToolbarItem(placement:.confirmationAction){Button("完成"){dismiss()}}}
                .sheet(item:$selected){revision in NavigationStack{ScrollView{VStack(alignment:.leading,spacing:20){Text(revision.title).font(.title2);MarkdownBody(body:revision.body,serif:true)}.padding(26)}.navigationTitle("版本预览").navigationBarTitleDisplayMode(.inline).toolbar{ToolbarItem(placement:.confirmationAction){Button("恢复此版本"){store.restoreRevision(revision,page:page);selected=nil;dismiss()}};ToolbarItem(placement:.cancellationAction){Button("取消"){selected=nil}}}}}
        }
    }
}
