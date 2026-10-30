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
                VStack(alignment:.leading,spacing:16){
                    if let notice=store.notice {
                        HStack(alignment:.top){Image(systemName:"info.circle");Text(notice).font(.caption).lineSpacing(4);Button{store.notice=nil}label:{Image(systemName:"xmark").font(.caption)}}.padding(16).background(Paper.surface,in:RoundedRectangle(cornerRadius:18))
                    }
                    if !store.workspace.notebooks.isEmpty {
                        VStack(alignment:.leading,spacing:8){
                            SectionCaption(title:"笔记本")
                            ScrollView(.horizontal,showsIndicators:false){
                                HStack(spacing:10){ForEach(store.workspace.notebooks){book in
                                    NavigationLink{PageCollection(title:book.name,notebook:book.id)}label:{
                                        HStack(spacing:8){
                                            Image(systemName:"folder").foregroundStyle(Paper.accent).accessibilityHidden(true)
                                            Text(book.name)
                                            Text("\(store.active.filter{$0.notebookID==book.id}.count)").foregroundStyle(.secondary)
                                        }.font(.subheadline).padding(.horizontal,14).frame(minHeight:44).background(Paper.surface,in:RoundedRectangle(cornerRadius:12)).foregroundStyle(Paper.ink)
                                    }.buttonStyle(.plain).accessibilityIdentifier("notebook."+book.id)
                                }}
                            }
                        }
                    }
                    VStack(alignment:.leading,spacing:0){
                        if !store.active.isEmpty {
                            HStack {Text(filter == "全部" ? "全部笔记" : "置顶笔记").font(.subheadline).foregroundStyle(.secondary);Spacer();Menu{Button("全部"){filter="全部"};Button("置顶"){filter="置顶"}}label:{Image(systemName:"line.3.horizontal.decrease").frame(width:44,height:44)}.accessibilityLabel("筛选笔记")}
                        }
                        if pages.isEmpty {EmptyPaper(title:filter == "全部" ? "暂无笔记" : "暂无置顶笔记").accessibilityIdentifier("notes.empty")}
                        else {ForEach(pages.prefix(30)){page in
                            Button{open(page)}label:{PageRow(page:page,book:store.bookName(page.notebookID))}.buttonStyle(.plain).accessibilityIdentifier("page."+page.id)
                                .contextMenu{Button(page.pinned ? "取消置顶" : "置顶",systemImage:"pin"){store.togglePin(page)};Button("移到废纸篓",systemImage:"trash",role:.destructive){store.trash(page)}}
                            Divider()
                        }}
                        if pages.count>30{NavigationLink("查看全部 \(pages.count) 篇"){PageCollection(title:"全部笔记")}.font(.subheadline).padding(.vertical,14)}
                    }
                }.padding(.horizontal,22).padding(.top,8).frame(maxWidth:760).frame(maxWidth:.infinity).padding(.bottom,24)
            }.background(Paper.background).navigationTitle("笔记").navigationBarTitleDisplayMode(.inline).pageNavigation()
                .toolbar{ToolbarItem(placement:.topBarTrailing){Button(action:create){Image(systemName:"square.and.pencil")}.accessibilityLabel("新建笔记").accessibilityIdentifier("notes.create")}}
        }
    }
}

struct PageCollection:View {
    @EnvironmentObject private var store:LibraryStore
    let title:String
    var notebook:String?=nil
    var tag:String?=nil
    private struct CollectionPage:Hashable {let id:String}
    @State private var openedPage:CollectionPage?
    @State private var editor:Page?
    var body:some View {
        List {
            let pages=store.search("",notebook:notebook,tag:tag)
            if pages.isEmpty {EmptyPaper(title:"暂无笔记").listRowBackground(Color.clear).listRowSeparator(.hidden)}
            ForEach(pages){page in Button{openedPage=CollectionPage(id:page.id)}label:{PageRow(page:page)}.buttonStyle(.plain).accessibilityIdentifier("page."+page.id).swipeActions{Button("废纸篓",role:.destructive){store.trash(page)}}}
        }.listStyle(.plain).background(Paper.background).scrollContentBackground(.hidden).navigationTitle(title).trashFeedback()
            .navigationDestination(item:$openedPage){PageDetail(pageID:$0.id)}
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
    private var otherDays:[Page]{store.active.filter{$0.kind == .journal && $0.journalDate != Day.key(day)}.sorted{($0.journalDate ?? "")>($1.journalDate ?? "")}}
    private var days:[Date]{let calendar=Calendar.current;let start=calendar.dateInterval(of:.weekOfYear,for:day)!.start;return(0..<7).compactMap{calendar.date(byAdding:.day,value:$0,to:start)}}
    var body:some View {
        NavigationStack(path:$path) {
            ScrollView {
                VStack(alignment:.leading,spacing:20){
                    VStack(alignment:.leading,spacing:10){
                        HStack(spacing:0){
                            Text(day,format:.dateTime.year().month(.wide)).font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal:false,vertical:true)
                            Spacer(minLength:4)
                            if !Calendar.current.isDateInToday(day){Button("今天"){day=Date()}.font(.subheadline.weight(.medium)).frame(minWidth:44,minHeight:44).accessibilityLabel("回到今天").accessibilityIdentifier("journal.today")}
                            Button{moveWeek(-1)}label:{Image(systemName:"chevron.left").frame(width:44,height:44)}.accessibilityLabel("上一周").accessibilityIdentifier("journal.previousWeek")
                            Button{moveWeek(1)}label:{Image(systemName:"chevron.right").frame(width:44,height:44)}.accessibilityLabel("下一周").accessibilityIdentifier("journal.nextWeek")
                            Button{showCalendar=true}label:{Image(systemName:"calendar").font(.title3).frame(width:44,height:44)}.glassControl().accessibilityLabel("选择日期").accessibilityIdentifier("journal.calendar")
                        }.foregroundStyle(Paper.accent)
                    }.padding(.top,10)
                    if typeSize.isAccessibilitySize {ScrollView(.horizontal,showsIndicators:false){weekStrip}} else {weekStrip}
                    if let page=selected {
                        VStack(alignment:.leading,spacing:16){
                            HStack{Text(day,format:.dateTime.month().day().weekday(.wide)).font(.caption).foregroundStyle(.secondary);Spacer();Text("\(page.wordCount) 字").font(.caption).foregroundStyle(.tertiary)}
                            Text(page.displayTitle).font(.system(.title2,design:.serif).weight(.medium))
                            MarkdownBody(body:page.body,serif:true).lineLimit(18)
                            Button{open(page)}label:{HStack{Text("继续阅读");Image(systemName:"arrow.up.right")}.font(.subheadline.weight(.medium)).padding(.top,10)}.accessibilityIdentifier("journal.read")
                        }.frame(maxWidth:.infinity,alignment:.leading)
                    } else {
                        EmptyPaper(title:"当天暂无日记").accessibilityIdentifier("journal.empty")
                    }
                    if !otherDays.isEmpty {SectionCaption(title:"其他日期")}
                    ForEach(otherDays){page in
                        Button{open(page)}label:{HStack(alignment:.top,spacing:17){Text(page.journalDate.map{String($0.suffix(5))} ?? "—").font(.system(.subheadline,design:.monospaced)).foregroundStyle(Paper.accent).frame(width:54,alignment:.leading).padding(.top,16);PageRow(page:page)}}.buttonStyle(.plain);Divider()
                    }
                }.padding(.horizontal,22).padding(.top,8).frame(maxWidth:760).frame(maxWidth:.infinity).padding(.bottom,24)
            }.background(Paper.background).navigationTitle("日记").navigationBarTitleDisplayMode(.inline).pageNavigation()
                .toolbar{ToolbarItem(placement:.topBarTrailing){Button{if let page=store.create(kind:.journal,date:day){edit(page)}}label:{Image(systemName:"square.and.pencil")}.accessibilityLabel(selected == nil ? "写日记" : "编辑日记").accessibilityIdentifier("journal.write")}}
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
                if !store.workspace.notebooks.isEmpty || !store.allTags.isEmpty {Section {
                    ScrollView(.horizontal,showsIndicators:false){HStack(spacing:9){
                        if !store.workspace.notebooks.isEmpty {Menu{Button("全部笔记本"){notebook=nil};ForEach(store.workspace.notebooks){book in Button(book.name){notebook=book.id}}}label:{Label(notebook.map{store.bookName($0)} ?? "笔记本",systemImage:"folder").font(.subheadline).padding(.horizontal,12).frame(minHeight:44)}}
                        if !store.allTags.isEmpty {Menu{Button("全部标签"){tag=nil};ForEach(store.allTags,id:\.self){value in Button("#"+value){tag=value}}}label:{Label(tag.map{"#"+$0} ?? "标签",systemImage:"number").font(.subheadline).padding(.horizontal,12).frame(minHeight:44)}}
                        if tag != nil || notebook != nil{Button("清除"){tag=nil;notebook=nil}.font(.caption)}
                    }.padding(.vertical,4)}
                }.listRowBackground(Color.clear).listRowSeparator(.hidden)}
                if query.isEmpty && tag == nil && notebook == nil {
                    if !recent.isEmpty {
                        Section {ForEach(recent,id:\.self){value in Button{query=value}label:{Label(value,systemImage:"clock.arrow.circlepath").foregroundStyle(Paper.ink)}.accessibilityIdentifier("search.recent."+value)}}header:{HStack{Text("最近搜索");Spacer();Button("清除"){recentSearches="[]"}.font(.caption).textCase(nil)}}
                    }
                    if !results.isEmpty {Section("最近笔记"){ForEach(results.prefix(5)){page in Button{open(page)}label:{PageRow(page:page)}.buttonStyle(.plain)}}}
                } else if results.isEmpty {EmptyPaper(title:"无搜索结果").listRowBackground(Color.clear).listRowSeparator(.hidden)}
                else {Section("找到 \(results.count) 篇"){ForEach(results){page in Button{open(page)}label:{PageRow(page:page,book:store.bookName(page.notebookID),query:query)}.buttonStyle(.plain)}}}
            }.listStyle(.plain).scrollContentBackground(.hidden).background(Paper.background).navigationTitle("搜索").navigationBarTitleDisplayMode(.inline).pageNavigation().searchable(text:$query,placement:.navigationBarDrawer(displayMode:.always),prompt:Text("")).autocorrectionDisabled()
                .scrollDismissesKeyboard(.interactively)
                .onSubmit(of:.search){rememberSearch();UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder),to:nil,from:nil,for:nil)}
        }
    }
}
