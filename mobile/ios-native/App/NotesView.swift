import SwiftUI
import UIKit

struct NotesView:View {
    @EnvironmentObject private var store:LibraryStore
    @State private var filter="全部"
    @State private var path:[PageRoute]=[]
    private func open(_ page:Page){path.append(PageRoute(id:page.id))}
    let create:()->Void
    private var pages:[Page]{store.active.filter{filter == "全部" || $0.pinned}.sorted{a,b in a.pinned != b.pinned ? a.pinned : a.updatedAt>b.updatedAt}}
    var body:some View {
        NavigationStack(path:$path) {
            ScrollView {
                VStack(alignment:.leading,spacing:22){
                    VStack(alignment:.leading,spacing:10){
                        Text(Date(),format:.dateTime.month(.wide).day().weekday(.wide)).font(.subheadline).foregroundStyle(.secondary)
                        Text("留住一个想法。").font(.system(.title,design:.serif).weight(.medium)).lineSpacing(4).fixedSize(horizontal:false,vertical:true)
                    }.padding(.top,12)
                    if let notice=store.notice {
                        HStack(alignment:.top){Image(systemName:"info.circle");Text(notice).font(.caption).lineSpacing(4);Button{store.notice=nil}label:{Image(systemName:"xmark").font(.caption)}}.padding(16).background(Paper.surface,in:RoundedRectangle(cornerRadius:18))
                    }
                    Button(action:create){
                        HStack(spacing:14){Image(systemName:"square.and.pencil").font(.title3);Text("新的一页").font(.body.weight(.medium));Spacer();Image(systemName:"plus").font(.body)}.padding(.horizontal,21).padding(.vertical,15)
                    }.foregroundStyle(Paper.accent).glassControl().accessibilityIdentifier("notes.create")
                    if !store.workspace.notebooks.isEmpty {
                        VStack(alignment:.leading,spacing:14){
                            SectionCaption(title:"我的笔记本",trailing:"\(store.workspace.notebooks.count) 本")
                            ScrollView(.horizontal,showsIndicators:false){
                                HStack(spacing:12){ForEach(store.workspace.notebooks){book in
                                    NavigationLink{PageCollection(title:book.name,notebook:book.id,open:open)}label:{
                                        VStack(alignment:.leading,spacing:14){Image(systemName:book.symbol).font(.system(size:24,weight:.light)).foregroundStyle(Paper.accent)
                                            VStack(alignment:.leading,spacing:5){Text(book.name).font(.subheadline.weight(.semibold));Text("\(store.active.filter{$0.notebookID==book.id}.count) 篇笔记").font(.caption).foregroundStyle(.secondary)}
                                        }.frame(width:145,alignment:.leading).padding(18).background(Paper.surface,in:RoundedRectangle(cornerRadius:19)).overlay(RoundedRectangle(cornerRadius:19).stroke(Paper.line)).foregroundStyle(Paper.ink)
                                    }.buttonStyle(.plain)
                                }}
                            }
                        }
                    }
                    VStack(alignment:.leading,spacing:8){
                        HStack {SectionCaption(title:filter == "全部" ? "最近写下" : "置顶笔记");Spacer();Menu{Button("全部"){filter="全部"};Button("置顶"){filter="置顶"}}label:{Image(systemName:"line.3.horizontal.decrease").frame(width:44,height:44)}.accessibilityLabel("筛选笔记")}
                        if pages.isEmpty {EmptyPaper(symbol:"doc.badge.plus",title:filter == "全部" ? "从空白的一页开始" : "还没有置顶笔记",message:filter == "全部" ? "记下一次灵感，或者今天发生的小事。\n所有内容自动保存在这台设备上。" : "打开笔记，轻点右上角菜单即可置顶。")}
                        else {ForEach(pages.prefix(30)){page in
                            Button{open(page)}label:{PageRow(page:page,book:store.bookName(page.notebookID))}.buttonStyle(.plain).accessibilityIdentifier("page."+page.id)
                                .contextMenu{Button(page.pinned ? "取消置顶" : "置顶",systemImage:"pin"){store.togglePin(page)};Button("移到废纸篓",systemImage:"trash",role:.destructive){store.trash(page)}}
                            Divider()
                        }}
                        if pages.count>30{NavigationLink("查看全部 \(pages.count) 篇"){PageCollection(title:"全部笔记",open:open)}.font(.subheadline).padding(.vertical,14)}
                    }
                    HStack(spacing:6){Image(systemName:"lock");Text("只在本机，属于你。")} .font(.caption).foregroundStyle(.tertiary).frame(maxWidth:.infinity).padding(.vertical,22)
                }.padding(.horizontal,24).frame(maxWidth:760).frame(maxWidth:.infinity).padding(.bottom,25)
            }.background(Paper.background).navigationTitle("LifeOS").navigationBarTitleDisplayMode(.inline).pageNavigation()
                .toolbar{ToolbarItem(placement:.topBarTrailing){NavigationLink{SettingsView()}label:{Image(systemName:"slider.horizontal.3")}.accessibilityLabel("设置")}}
        }
    }
}

struct PageCollection:View {
    @EnvironmentObject private var store:LibraryStore
    let title:String
    var notebook:String?=nil
    var tag:String?=nil
    let open:(Page)->Void
    @State private var editor:Page?
    var body:some View {
        List {
            let pages=store.search("",notebook:notebook,tag:tag)
            if pages.isEmpty {EmptyPaper(symbol:"folder",title:"这里还是空白",message:"把相关笔记放在一起，想找时就更容易。") .listRowBackground(Color.clear).listRowSeparator(.hidden)}
            ForEach(pages){page in Button{open(page)}label:{PageRow(page:page)}.buttonStyle(.plain).swipeActions{Button("废纸篓",role:.destructive){store.trash(page)}}}
        }.listStyle(.plain).background(Paper.background).scrollContentBackground(.hidden).navigationTitle(title)
            .toolbar{ToolbarItem(placement:.topBarTrailing){Button{editor=store.create(kind:.note,notebook:notebook)}label:{Image(systemName:"square.and.pencil")}.accessibilityLabel("新建笔记")}}
            .sheet(item:$editor){PageEditor(initial:$0)}
    }
}

struct JournalView:View {
    @EnvironmentObject private var store:LibraryStore
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var day=Date()
    @State private var showCalendar=false
    @State private var path:[PageRoute]=[]
    private func open(_ page:Page){path.append(PageRoute(id:page.id))}
    let edit:(Page)->Void
    private var selected:Page?{store.active.first{$0.kind == .journal && $0.journalDate==Day.key(day)}}
    private var days:[Date]{let calendar=Calendar.current;let start=calendar.dateInterval(of:.weekOfYear,for:day)!.start;return(0..<7).compactMap{calendar.date(byAdding:.day,value:$0,to:start)}}
    var body:some View {
        NavigationStack(path:$path) {
            ScrollView {
                VStack(alignment:.leading,spacing:28){
                    VStack(alignment:.leading,spacing:10){
                        HStack(spacing:0){
                            Text(day,format:.dateTime.year().month(.wide)).font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal:false,vertical:true)
                            Spacer(minLength:4)
                            if !Calendar.current.isDateInToday(day){Button("今天"){day=Date()}.font(.subheadline.weight(.medium)).frame(minWidth:44,minHeight:44).accessibilityLabel("回到今天").accessibilityIdentifier("journal.today")}
                            Button{moveWeek(-1)}label:{Image(systemName:"chevron.left").frame(width:44,height:44)}.accessibilityLabel("上一周").accessibilityIdentifier("journal.previousWeek")
                            Button{moveWeek(1)}label:{Image(systemName:"chevron.right").frame(width:44,height:44)}.accessibilityLabel("下一周").accessibilityIdentifier("journal.nextWeek")
                            Button{showCalendar=true}label:{Image(systemName:"calendar").font(.title3).frame(width:44,height:44)}.glassControl().accessibilityLabel("选择日期").accessibilityIdentifier("journal.calendar")
                        }.foregroundStyle(Paper.accent)
                        Text("日子，一页一页。").font(.system(.title,design:.serif))
                    }.padding(.top,10)
                    if typeSize.isAccessibilitySize {ScrollView(.horizontal,showsIndicators:false){weekStrip}} else {weekStrip}
                    if let page=selected {
                        VStack(alignment:.leading,spacing:17){
                            HStack{Text(day,format:.dateTime.month().day().weekday(.wide)).font(.caption).foregroundStyle(.secondary);Spacer();Text("\(page.wordCount) 字").font(.caption).foregroundStyle(.tertiary)}
                            Text(page.displayTitle).font(.system(.title2,design:.serif).weight(.medium))
                            MarkdownBody(body:page.body,serif:true).lineLimit(18)
                            Button{open(page)}label:{HStack{Text("继续阅读");Image(systemName:"arrow.up.right")}.font(.subheadline.weight(.medium)).padding(.top,10)}.accessibilityIdentifier("journal.read")
                        }.padding(24).frame(maxWidth:.infinity,alignment:.leading).background(Paper.surface,in:RoundedRectangle(cornerRadius:24)).overlay(RoundedRectangle(cornerRadius:24).stroke(Paper.line))
                        Button{edit(page)}label:{Label(Calendar.current.isDateInToday(day) ? "继续写今天" : "继续写这一天",systemImage:"square.and.pencil").padding(.horizontal,22).padding(.vertical,14)}.glassControl().frame(maxWidth:.infinity)
                    } else {
                        EmptyPaper(symbol:"sun.horizon",title:Calendar.current.isDateInToday(day) ? "今天，还留着空白" : "这一天，还没有记录",message:"不必写得完整。\n一句话，也能留住今天。",action:"写下这一天"){if let page=store.create(kind:.journal,date:day){edit(page)}}.background(Paper.surface,in:RoundedRectangle(cornerRadius:24))
                    }
                    SectionCaption(title:"沿着时间翻阅",trailing:"\(store.active.filter{$0.kind == .journal}.count) 天")
                    ForEach(store.active.filter{$0.kind == .journal}.sorted{($0.journalDate ?? "")>($1.journalDate ?? "")}){page in
                        Button{open(page)}label:{HStack(alignment:.top,spacing:17){Text(page.journalDate.map{String($0.suffix(5))} ?? "—").font(.system(.subheadline,design:.monospaced)).foregroundStyle(Paper.accent).frame(width:54,alignment:.leading).padding(.top,16);PageRow(page:page)}}.buttonStyle(.plain);Divider()
                    }
                }.padding(24).frame(maxWidth:760).frame(maxWidth:.infinity).padding(.bottom,30)
            }.background(Paper.background).navigationTitle("日记").navigationBarTitleDisplayMode(.inline).pageNavigation()
                .sheet(isPresented:$showCalendar){NavigationStack{ScrollView{DatePicker("选择一天",selection:$day,displayedComponents:.date).datePickerStyle(.graphical).padding().accessibilityIdentifier("journal.datePicker")}.navigationTitle("选择日期").navigationBarTitleDisplayMode(.inline).toolbar{ToolbarItem(placement:.confirmationAction){Button("完成"){showCalendar=false}.accessibilityIdentifier("journal.calendar.done")}}}.presentationDetents([.height(500),.large]).presentationDragIndicator(.visible)}
        }
    }
    private func moveWeek(_ delta:Int){if let date=Calendar.current.date(byAdding:.day,value:delta*7,to:day){day=date}}
    private var weekStrip:some View {
        HStack(spacing:typeSize.isAccessibilitySize ? 8 : 4){ForEach(days,id:\.self){date in
            let chosen=Day.key(date)==Day.key(day)
            let hasPage=store.active.contains{$0.kind == .journal && $0.journalDate==Day.key(date)}
            Button{day=date}label:{VStack(spacing:12){Text(date,format:.dateTime.weekday(.narrow)).font(.caption);Text(date,format:.dateTime.day()).font(.body.weight(chosen ? .semibold : .regular));Circle().fill(hasPage ? (chosen ? Color.white : Paper.accent) : .clear).frame(width:4,height:4)}.frame(width:typeSize.isAccessibilitySize ? 80 : nil).frame(maxWidth:.infinity).padding(.vertical,12).foregroundStyle(chosen ? .white : .primary).background(chosen ? Paper.accent : Color.clear,in:Capsule())}.buttonStyle(.plain).accessibilityLabel(date.formatted(date:.complete,time:.omitted)).accessibilityAddTraits(chosen ? .isSelected : [])
        }}
    }
}

struct SearchView:View {
    @EnvironmentObject private var store:LibraryStore
    @State private var query=""
    @State private var tag:String?
    @State private var notebook:String?
    @State private var path:[PageRoute]=[]
    @AppStorage("recentSearches") private var recentSearches="[]"
    private var recent:[String]{(try? JSONDecoder().decode([String].self,from:Data(recentSearches.utf8))) ?? []}
    private func open(_ page:Page){rememberSearch();path.append(PageRoute(id:page.id))}
    private func rememberSearch(){
        let value=String(query.trimmingCharacters(in:.whitespacesAndNewlines).prefix(120))
        guard !value.isEmpty else{return}
        let values=Array(([value]+recent.filter{$0 != value}).prefix(5))
        if let bytes=try? JSONEncoder().encode(values),let encoded=String(data:bytes,encoding:.utf8){recentSearches=encoded}
    }
    private var results:[Page]{store.search(query,notebook:notebook,tag:tag)}
    var body:some View {
        NavigationStack(path:$path) {
            List {
                Section {
                    ScrollView(.horizontal,showsIndicators:false){HStack(spacing:9){
                        Menu{Button("全部笔记本"){notebook=nil};ForEach(store.workspace.notebooks){book in Button(book.name){notebook=book.id}}}label:{Label(notebook.map{store.bookName($0)} ?? "笔记本",systemImage:"folder").font(.subheadline).padding(.horizontal,14).padding(.vertical,10).glassControl()}
                        Menu{Button("全部标签"){tag=nil};ForEach(store.allTags,id:\.self){value in Button("#"+value){tag=value}}}label:{Label(tag.map{"#"+$0} ?? "标签",systemImage:"number").font(.subheadline).padding(.horizontal,14).padding(.vertical,10).glassControl()}
                        if tag != nil || notebook != nil{Button("清除"){tag=nil;notebook=nil}.font(.caption)}
                    }.padding(.vertical,4)}
                }.listRowBackground(Color.clear).listRowSeparator(.hidden)
                if query.isEmpty && tag == nil && notebook == nil {
                    if !recent.isEmpty {
                        Section {ForEach(recent,id:\.self){value in Button{query=value}label:{Label(value,systemImage:"clock.arrow.circlepath").foregroundStyle(Paper.ink)}.accessibilityIdentifier("search.recent."+value)}}header:{HStack{Text("最近搜索");Spacer();Button("清除"){recentSearches="[]"}.font(.caption).textCase(nil)}}
                    }
                    Section {EmptyPaper(symbol:"text.magnifyingglass",title:"循着一句话，找到那一页",message:"搜索标题、正文与标签。\n多个关键词可以一起查找。") .listRowSeparator(.hidden).listRowBackground(Color.clear)}
                    Section("最近写下"){ForEach(results.prefix(5)){page in Button{open(page)}label:{PageRow(page:page)}.buttonStyle(.plain)}}
                } else if results.isEmpty {EmptyPaper(symbol:"magnifyingglass",title:"还没有找到",message:"换一个关键词，或试试清除筛选。") .listRowBackground(Color.clear).listRowSeparator(.hidden)}
                else {Section("找到 \(results.count) 篇"){ForEach(results){page in Button{open(page)}label:{PageRow(page:page,book:store.bookName(page.notebookID),query:query)}.buttonStyle(.plain)}}}
            }.listStyle(.plain).scrollContentBackground(.hidden).background(Paper.background).navigationTitle("搜索").pageNavigation().searchable(text:$query,prompt:"标题、正文或 #标签").autocorrectionDisabled()
                .scrollDismissesKeyboard(.interactively)
                .onSubmit(of:.search){rememberSearch();UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder),to:nil,from:nil,for:nil)}
        }
    }
}
