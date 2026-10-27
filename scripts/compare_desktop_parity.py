"""Compare actual Windows/macOS renderer evidence in CSS pixels."""
from pathlib import Path
import argparse, json

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('windows',type=Path)
parser.add_argument('mac',type=Path,nargs='+')
parser.add_argument('--output',type=Path,required=True)
args=parser.parse_args()
windows=json.loads(args.windows.read_text(encoding='utf-8'))
assert windows['ok'] and windows['platform']=='win32'
results=[]
for file in args.mac:
 mac=json.loads(file.read_text(encoding='utf-8'))
 assert mac['ok'] and mac['platform']=='darwin'
 assert mac['renderer_sha256']==windows['renderer_sha256'],'renderer assets differ'
 assert mac['fonts']==windows['fonts'],'font availability differs'
 assert mac['tools']==windows['tools'],'tool catalog differs'
 assert [x['name'] for x in mac['pages']]==[x['name'] for x in windows['pages']]
 differences=[]; measurements=0
 for win,other in zip(windows['pages'],mac['pages']):
  for key in ['width','height','bodyOverflow']:
   if win[key]!=other[key]:differences.append({'page':win['name'],'field':key,'win':win[key],'mac':other[key]})
  for selector,nodes in win['rows'].items():
   peers=other['rows'][selector]
   if len(nodes)!=len(peers):
    differences.append({'page':win['name'],'selector':selector,'win_nodes':len(nodes),'mac_nodes':len(peers)});continue
   for index,(node,peer) in enumerate(zip(nodes,peers)):
    for key in ['x','y','width','height','font','size','line']:
     a,b=node[key],peer[key];measurements+=1
     match=abs(a-b)<=1 if isinstance(a,(float,int)) and isinstance(b,(float,int)) else a==b
     if not match:differences.append({'page':win['name'],'selector':selector,'node':index,'field':key,'win':a,'mac':b})
 results.append({'arch':mac['arch'],'ok':not differences,'visual_cases':len(mac['pages']),
                 'tool_pages':len(mac['tools']),'measurements':measurements,'differences':differences})
report={'ok':all(x['ok'] for x in results),'renderer_sha256':windows['renderer_sha256'],
        'geometry_tolerance_css_px':1,'pixel_identical_claim':False,
        'note':'Identical assets, fonts, tools and measured layout; OS text rasterization may differ. Screenshots require visual review.',
        'results':results}
args.output.write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
print(json.dumps({**report,'results':[{**x,'differences':x['differences'][:12]} for x in results]},ensure_ascii=False))
raise SystemExit(0 if report['ok'] else 1)
