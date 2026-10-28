import SwiftUI

enum Paper {
    static let background=Color("PaperBackground")
    static let surface=Color("PaperSurface")
    static let ink=Color.primary
    static let secondary=Color.secondary
    static let accent=Color("Evergreen")
    static let line=Color.primary.opacity(0.09)
}

struct GlassControl:ViewModifier {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    func body(content:Content)->some View {
        if reduceTransparency {content.background(Paper.surface,in:Capsule()).overlay(Capsule().stroke(Paper.line))}
        else if #available(iOS 26.0,*) {content.glassEffect(.regular.interactive(),in:.capsule)}
        else {content.background(.regularMaterial,in:Capsule()).overlay(Capsule().stroke(.white.opacity(0.35)))}
    }
}
extension View {
    func glassControl()->some View{modifier(GlassControl())}
}

struct SectionCaption:View {
    var title:String
    var trailing:String?=nil
    var body:some View {
        HStack {Text(title).font(.subheadline.weight(.semibold));Spacer();if let trailing{Text(trailing).font(.caption).foregroundStyle(.secondary)}}
            .padding(.top,12).accessibilityAddTraits(.isHeader)
    }
}
struct EmptyPaper:View {
    var symbol:String
    var title:String
    var message:String
    var action:String?=nil
    var perform:(()->Void)?=nil
    var body:some View {
        VStack(spacing:16){
            Image(systemName:symbol).font(.system(size:34,weight:.ultraLight)).foregroundStyle(Paper.accent).frame(height:52).accessibilityHidden(true)
            Text(title).font(.title3.weight(.semibold))
            Text(message).font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center).lineSpacing(5)
            if let action,let perform{Button(action,action:perform).buttonStyle(.borderedProminent).buttonBorderShape(.capsule).controlSize(.large).padding(.top,6)}
        }.frame(maxWidth:460).padding(.horizontal,30).padding(.vertical,54).frame(maxWidth:.infinity)
    }
}
struct PageRow:View {
    let page:Page
    var book:String?=nil
    var body:some View {
        HStack(alignment:.top,spacing:15){
            Image(systemName:page.kind == .journal ? "sun.horizon" : "doc.text").font(.system(size:21,weight:.light)).foregroundStyle(Paper.accent).frame(width:27).padding(.top,3).accessibilityHidden(true)
            VStack(alignment:.leading,spacing:7){
                HStack(alignment:.firstTextBaseline){Text(page.displayTitle).font(.body.weight(.medium)).foregroundStyle(Paper.ink).lineLimit(2);if page.pinned{Image(systemName:"pin.fill").font(.caption2).foregroundStyle(.tertiary)}}
                if !page.excerpt.isEmpty{Text(page.excerpt).font(.subheadline).foregroundStyle(.secondary).lineLimit(2).lineSpacing(3)}
                HStack(spacing:8){Text(page.updatedAt,format:.dateTime.month(.abbreviated).day());if let book{Text("·");Text(book)};if let tag=page.tags.first{Text("#"+tag).foregroundStyle(Paper.accent)}}.font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength:0)
        }.padding(.vertical,13).contentShape(Rectangle()).accessibilityElement(children:.combine)
    }
}
