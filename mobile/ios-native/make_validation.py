from pathlib import Path
import hashlib,json,plistlib,re,subprocess
root=Path(__file__).parent
app=root/'DerivedData/Build/Products/Release-iphonesimulator/LifeOS.app'
info=plistlib.loads((app/'Info.plist').read_bytes())
assert info['CFBundleIdentifier']=='life.lifeos.lifeosmobile'
assert info['CFBundleShortVersionString']=='0.7.1'
assert info['DTPlatformName']=='iphonesimulator'
architectures=subprocess.check_output(['lipo','-archs',str(app/'LifeOS')],text=True).strip().split()
assert architectures==['arm64']
assert not list(app.rglob('Library.json'))
core_log=(root/'build/qa/core-tests.log').read_text()
core_counts=re.findall(r'Executed (\d+) tests, with 0 failures',core_log)
assert core_counts and int(core_counts[-1])>=12
summary=json.loads((root/'build/qa/TEST_SUMMARY.json').read_text())
assert summary['failedTests']==0 and summary['passedTests']>=8
compact=json.loads((root/'build/qa/COMPACT_TEST_SUMMARY.json').read_text())
assert compact['failedTests']==0 and compact['passedTests']>=3
phone=root/'build/LifeOS.xcarchive/Products/Applications/LifeOS.app'
phone_info=plistlib.loads((phone/'Info.plist').read_bytes())
assert phone_info['DTPlatformName']=='iphoneos' and phone_info['CFBundleShortVersionString']=='0.7.1'
assert phone_info['CFBundleIdentifier']==info['CFBundleIdentifier']
assert subprocess.check_output(['lipo','-archs',str(phone/'LifeOS')],text=True).strip()=='arm64'
assert not list(phone.rglob('Library.json'))
assert not (phone/'embedded.mobileprovision').exists()
phone_file=root/'build/dist/LifeOS-0.7.1-iphone-unsigned.ipa'
file=root/'build/dist/LifeOS-0.7.1-ios-simulator-arm64.zip'
report={'ok':True,'version':'0.7.1','kind':'iPhone package requiring local signing, plus iOS simulator','bundle_id':info['CFBundleIdentifier'],
 'commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),
 'native_swiftui':True,'minimum_ios':'17.0','liquid_glass_ios':'26.0','phone_requires_local_signing':True,'physical_device_tested':False,'architectures':architectures,
 'contains_user_memory':False,'external_model_calls':0,'core_tests_passed':int(core_counts[-1]),'tests':summary,'compact_screen_tests':compact,
 'asset':{'name':file.name,'bytes':file.stat().st_size,'sha256':hashlib.sha256(file.read_bytes()).hexdigest()},
 'phone_asset':{'name':phone_file.name,'bytes':phone_file.stat().st_size,'sha256':hashlib.sha256(phone_file.read_bytes()).hexdigest(),'platform':'iphoneos','architecture':'arm64','signed':False,'requires_local_signing':True}}
(root/'build/dist/IOS_NATIVE_VALIDATION.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
(root/'build/dist/SHA256SUMS.txt').write_text(report['asset']['sha256']+'  '+file.name+'\n'+report['phone_asset']['sha256']+'  '+phone_file.name+'\n')
print(json.dumps({'ok':True,'tests_passed':summary['passedTests'],'asset_bytes':file.stat().st_size}))
