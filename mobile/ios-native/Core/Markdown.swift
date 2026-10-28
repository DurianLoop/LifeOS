import Foundation

enum Markdown {
    struct Block:Identifiable,Equatable {
        enum Kind:Equatable {case line,code,divider}
        var id:Int
        var kind:Kind
        var text:String
        var language:String=""
    }
    static func blocks(_ source:String)->[Block]{
        let lines=readableContent(source).components(separatedBy:"\n")
        var result:[Block]=[]
        var index=0
        while index<lines.count {
            let text=lines[index].trimmingCharacters(in:.whitespaces)
            if text.hasPrefix("```") || text.hasPrefix("~~~") {
                let marker=text.first!
                let fence=String(text.prefix(while:{$0==marker}))
                let language=String(text.dropFirst(fence.count)).trimmingCharacters(in:.whitespaces)
                let start=index;index+=1
                var code:[String]=[]
                while index<lines.count {
                    let candidate=lines[index].trimmingCharacters(in:.whitespaces)
                    if candidate.count>=fence.count && candidate.allSatisfy({$0==marker}) {index+=1;break}
                    code.append(lines[index]);index+=1
                }
                result.append(Block(id:start,kind:.code,text:code.joined(separator:"\n"),language:language))
                continue
            }
            result.append(Block(id:index,kind:["---","***","___"].contains(text) ? .divider : .line,text:lines[index]))
            index+=1
        }
        return result
    }
    static func readableContent(_ text:String)->String{
        let normalized=text.replacingOccurrences(of:"\r\n",with:"\n")
        guard normalized.hasPrefix("---\n"),let end=normalized.range(of:"\n---",range:normalized.index(normalized.startIndex,offsetBy:4)..<normalized.endIndex) else{return normalized}
        return String(normalized[end.upperBound...]).trimmingCharacters(in:.newlines)
    }
    static func linkTitles(_ text:String)->[String]{
        guard let regex=try? NSRegularExpression(pattern:#"\[\[([^\]\n]+)\]\]"#)else{return[]}
        return regex.matches(in:text,range:NSRange(text.startIndex...,in:text)).compactMap{match in Range(match.range(at:1),in:text).map{String(text[$0])}}
    }
    static func inlineLinks(_ text:String)->String{
        guard let regex=try? NSRegularExpression(pattern:#"\[\[([^\]\n]+)\]\]"#)else{return text}
        var result=text
        for match in regex.matches(in:text,range:NSRange(text.startIndex...,in:text)).reversed(){
            guard let full=Range(match.range,in:result),let titleRange=Range(match.range(at:1),in:text)else{continue}
            let title=String(text[titleRange]);var url=URLComponents();url.scheme="lifeos";url.host="note";url.queryItems=[URLQueryItem(name:"title",value:title)]
            result.replaceSubrange(full,with:"[\(title)](\(url.string ?? ""))")
        }
        return result
    }
    static func toggleTask(_ body:String,line:Int)->String{
        var lines=body.components(separatedBy:"\n")
        guard lines.indices.contains(line)else{return body}
        if lines[line].hasPrefix("- [ ] "){lines[line]="- [x] "+lines[line].dropFirst(6)}
        else if lines[line].hasPrefix("- [x] "){lines[line]="- [ ] "+lines[line].dropFirst(6)}
        return lines.joined(separator:"\n")
    }
    static func toggleVisibleTask(_ body:String,line:Int)->String{
        let normalized=body.replacingOccurrences(of:"\r\n",with:"\n")
        let visible=readableContent(normalized)
        guard normalized.hasSuffix(visible)else{return body}
        return String(normalized.dropLast(visible.count))+toggleTask(visible,line:line)
    }
}
