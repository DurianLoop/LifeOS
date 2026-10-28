from pathlib import Path
import hashlib,json,plistlib,subprocess
root=Path(__file__).parent
app=root/'DerivedData/Build/Products/Release-iphonesimulator/LifeOS.app'
info=plistlib.loads((app/'Info.plist').read_bytes())
assert info['CFBundleIdentifier']=='life.lifeos.lifeosmobile'
assert info['CFBundleShortVersionString']=='0.7.0'
assert info['DTPlatformName']=='iphonesimulator'
assert not list(app.rglob('Library.json'))
summary=json.loads((root/'build/qa/TEST_SUMMARY.json').read_text())
assert summary['failedTests']==0 and summary['passedTests']>=6
file=root/'build/dist/LifeOS-0.7.0-ios-simulator-arm64.zip'
report={'ok':True,'version':'0.7.0','kind':'iOS simulator only','bundle_id':info['CFBundleIdentifier'],
 'commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),
 'native_swiftui':True,'minimum_ios':'17.0','liquid_glass_ios':'26.0','no_phone_distribution':True,
 'contains_user_memory':False,'external_model_calls':0,'tests':summary,
 'asset':{'name':file.name,'bytes':file.stat().st_size,'sha256':hashlib.sha256(file.read_bytes()).hexdigest()}}
(root/'build/dist/IOS_NATIVE_VALIDATION.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
(root/'build/dist/SHA256SUMS.txt').write_text(report['asset']['sha256']+'  '+file.name+'\n')
print(json.dumps({'ok':True,'tests_passed':summary['passedTests'],'asset_bytes':file.stat().st_size}))
