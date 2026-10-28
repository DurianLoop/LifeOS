"""Generate a dependency-free Xcode project from the checked-in Swift sources."""
from pathlib import Path
import hashlib,json
import xml.etree.ElementTree as ET

root=Path(__file__).resolve().parent
project=root/'LifeOS.xcodeproj'
project.mkdir(exist_ok=True)
objects={}
def obj(identity,isa,**fields):
    key=hashlib.sha1(identity.encode()).hexdigest()[:24].upper()
    objects[key]={'isa':isa,**fields}
    return key
def encode(value,level=0):
    if isinstance(value,dict):return '{\n'+''.join('\t'*(level+1)+json.dumps(k)+' = '+encode(v,level+1)+';\n' for k,v in value.items())+'\t'*level+'}'
    if isinstance(value,list):return '('+', '.join(encode(v,level+1) for v in value)+')'
    return json.dumps(str(value))

products=obj('products','PBXGroup',children=[],name='Products',sourceTree='<group>')
appProduct=obj('app-product','PBXFileReference',explicitFileType='wrapper.application',path='LifeOS.app',sourceTree='BUILT_PRODUCTS_DIR')
testProduct=obj('test-product','PBXFileReference',explicitFileType='wrapper.cfbundle',path='LifeOSUITests.xctest',sourceTree='BUILT_PRODUCTS_DIR')
objects[products]['children']=[appProduct,testProduct]
children=[products];appFiles=[];testFiles=[]
for directory in ['Core','App','UITests']:
    files=[]
    for file in sorted((root/directory).glob('*.swift')):
        ref=obj(str(file.relative_to(root)),'PBXFileReference',lastKnownFileType='sourcecode.swift',path=file.name,sourceTree='<group>')
        files.append(ref)
        build=obj('build-'+str(file.relative_to(root)),'PBXBuildFile',fileRef=ref)
        (testFiles if directory=='UITests' else appFiles).append(build)
    children.append(obj(directory,'PBXGroup',path=directory,children=files,sourceTree='<group>'))
assets=obj('assets','PBXFileReference',lastKnownFileType='folder.assetcatalog',path='Assets.xcassets',sourceTree='<group>')
children.append(assets)
mainGroup=obj('main-group','PBXGroup',children=children,sourceTree='<group>')
privacy=obj('privacy','PBXFileReference',lastKnownFileType='text.xml',path='PrivacyInfo.xcprivacy',sourceTree='<group>')
objects[mainGroup]['children'].append(privacy)
resources=obj('resources','PBXResourcesBuildPhase',buildActionMask='2147483647',files=[obj('assets-build','PBXBuildFile',fileRef=assets),obj('privacy-build','PBXBuildFile',fileRef=privacy)],runOnlyForDeploymentPostprocessing='0')
emptyResources=obj('test-resources','PBXResourcesBuildPhase',buildActionMask='2147483647',files=[],runOnlyForDeploymentPostprocessing='0')
def phase(name,files):return obj(name,'PBXSourcesBuildPhase',buildActionMask='2147483647',files=files,runOnlyForDeploymentPostprocessing='0')
base={'SDKROOT':'iphoneos','IPHONEOS_DEPLOYMENT_TARGET':'17.0','SWIFT_VERSION':'5.0','CLANG_ENABLE_MODULES':'YES','TARGETED_DEVICE_FAMILY':'1,2','CODE_SIGNING_ALLOWED':'NO','ENABLE_USER_SCRIPT_SANDBOXING':'YES','SWIFT_STRICT_CONCURRENCY':'targeted','DEBUG_INFORMATION_FORMAT':'dwarf-with-dsym'}
appSettings={**base,'PRODUCT_BUNDLE_IDENTIFIER':'life.lifeos.lifeosmobile','PRODUCT_NAME':'LifeOS','GENERATE_INFOPLIST_FILE':'YES','INFOPLIST_KEY_CFBundleDisplayName':'LifeOS','INFOPLIST_KEY_UILaunchScreen_Generation':'YES','INFOPLIST_KEY_UIApplicationSceneManifest_Generation':'YES','INFOPLIST_KEY_UISupportedInterfaceOrientations_iPhone':'UIInterfaceOrientationPortrait UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight','INFOPLIST_KEY_UISupportedInterfaceOrientations_iPad':'UIInterfaceOrientationPortrait UIInterfaceOrientationPortraitUpsideDown UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight','INFOPLIST_KEY_LSSupportsOpeningDocumentsInPlace':'YES','MARKETING_VERSION':'0.7.0','CURRENT_PROJECT_VERSION':'700','ASSETCATALOG_COMPILER_APPICON_NAME':'AppIcon','OTHER_LDFLAGS':['$(inherited)','-lsqlite3','-lz'],'LD_RUNPATH_SEARCH_PATHS':['$(inherited)','@executable_path/Frameworks']}
def config(name,settings):
    ids=[]
    for mode in ['Debug','Release']:
        values={**settings,'SWIFT_OPTIMIZATION_LEVEL':'-Onone' if mode=='Debug' else '-O'}
        if mode=='Debug':values['SWIFT_ACTIVE_COMPILATION_CONDITIONS']='DEBUG $(inherited)'
        ids.append(obj(name+mode,'XCBuildConfiguration',name=mode,buildSettings=values))
    return obj(name+'configs','XCConfigurationList',buildConfigurations=ids,defaultConfigurationIsVisible='0',defaultConfigurationName='Release')
appID=obj('app-target','PBXNativeTarget',name='LifeOS',productName='LifeOS',productReference=appProduct,productType='com.apple.product-type.application',buildConfigurationList=config('app',appSettings),buildPhases=[phase('app-sources',appFiles),resources],buildRules=[],dependencies=[])
projectID=hashlib.sha1(b'project').hexdigest()[:24].upper()
proxy=obj('test-proxy','PBXContainerItemProxy',containerPortal=projectID,proxyType='1',remoteGlobalIDString=appID,remoteInfo='LifeOS')
dependency=obj('test-dependency','PBXTargetDependency',target=appID,targetProxy=proxy)
testID=obj('test-target','PBXNativeTarget',name='LifeOSUITests',productName='LifeOSUITests',productReference=testProduct,productType='com.apple.product-type.bundle.ui-testing',buildConfigurationList=config('test',{**base,'PRODUCT_BUNDLE_IDENTIFIER':'life.lifeos.lifeosmobile.uitests','GENERATE_INFOPLIST_FILE':'YES','TEST_TARGET_NAME':'LifeOS','PRODUCT_NAME':'$(TARGET_NAME)','LD_RUNPATH_SEARCH_PATHS':['$(inherited)','@executable_path/Frameworks','@loader_path/Frameworks']}),buildPhases=[phase('test-sources',testFiles),emptyResources],buildRules=[],dependencies=[dependency])
obj('project','PBXProject',attributes={'LastUpgradeCheck':'2600','BuildIndependentTargetsInParallel':'YES','TargetAttributes':{testID:{'TestTargetID':appID}}},buildConfigurationList=config('project',base),compatibilityVersion='Xcode 14.0',developmentRegion='zh-Hans',knownRegions=['zh-Hans','en','Base'],mainGroup=mainGroup,productRefGroup=products,projectDirPath='',projectRoot='',targets=[appID,testID])
(project/'project.pbxproj').write_text('// !$*UTF8*$!\n'+encode({'archiveVersion':'1','classes':{},'objectVersion':'56','objects':objects,'rootObject':projectID})+'\n',encoding='utf-8')

def buildable(parent,identifier,name,blueprint):
    ET.SubElement(parent,'BuildableReference',BuildableIdentifier='primary',BlueprintIdentifier=identifier,BuildableName=name,BlueprintName=blueprint,ReferencedContainer='container:LifeOS.xcodeproj')
scheme=ET.Element('Scheme',LastUpgradeVersion='2600',version='1.3')
build=ET.SubElement(scheme,'BuildAction',parallelizeBuildables='YES',buildImplicitDependencies='YES')
entries=ET.SubElement(build,'BuildActionEntries')
entry=ET.SubElement(entries,'BuildActionEntry',buildForTesting='YES',buildForRunning='YES',buildForProfiling='YES',buildForArchiving='YES',buildForAnalyzing='YES');buildable(entry,appID,'LifeOS.app','LifeOS')
test=ET.SubElement(scheme,'TestAction',buildConfiguration='Debug',selectedDebuggerIdentifier='Xcode.DebuggerFoundation.Debugger.LLDB',selectedLauncherIdentifier='Xcode.IDEFoundation.Launcher.LLDB',shouldUseLaunchSchemeArgsEnv='YES')
testables=ET.SubElement(test,'Testables');ref=ET.SubElement(testables,'TestableReference',skipped='NO',parallelizable='NO');buildable(ref,testID,'LifeOSUITests.xctest','LifeOSUITests')
launch=ET.SubElement(scheme,'LaunchAction',buildConfiguration='Debug',selectedDebuggerIdentifier='Xcode.DebuggerFoundation.Debugger.LLDB',selectedLauncherIdentifier='Xcode.IDEFoundation.Launcher.LLDB',launchStyle='0',useCustomWorkingDirectory='NO',ignoresPersistentStateOnLaunch='NO',debugDocumentVersioning='YES',debugServiceExtension='internal',allowLocationSimulation='YES')
runnable=ET.SubElement(launch,'BuildableProductRunnable',runnableDebuggingMode='0');buildable(runnable,appID,'LifeOS.app','LifeOS')
ET.SubElement(scheme,'AnalyzeAction',buildConfiguration='Debug');ET.SubElement(scheme,'ArchiveAction',buildConfiguration='Release',revealArchiveInOrganizer='YES')
schemeDir=project/'xcshareddata/xcschemes';schemeDir.mkdir(parents=True,exist_ok=True)
ET.ElementTree(scheme).write(schemeDir/'LifeOS.xcscheme',encoding='utf-8',xml_declaration=True)
print('Generated LifeOS.xcodeproj (native app + UI acceptance, no external package dependencies)')
