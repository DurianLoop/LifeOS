"""Exercise bundled and downloaded pet removal in isolated resource/workspace trees."""
import ast,json,shutil,tempfile,unittest,re
from pathlib import Path
from urllib.parse import quote

ROOT=Path(__file__).resolve().parents[1]
names={'pet_removed_slugs','pet_package_items','pet_local_items','pet_status','install_pet','uninstall_pet'}
tree=ast.parse((ROOT/'backend/server.py').read_text(encoding='utf-8'))
code=compile(ast.Module(body=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in names],type_ignores=[]),'backend/server.py','exec')

class Settings:
    def __init__(self,root):self.path=root/'settings.json'
    def get_setting(self,key,default,root):
        value=json.loads(self.path.read_text()).get(key,default) if self.path.exists() else default
        return json.dumps(value) if isinstance(value,(list,dict)) else value
    def set_settings(self,values,root):
        old=json.loads(self.path.read_text()) if self.path.exists() else {};old.update(values);self.path.write_text(json.dumps(old))

class RemovalTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.base=Path(self.tmp.name);self.root=self.base/'workspace';self.root.mkdir();self.app=self.base/'resources/app'
        self.assets=self.root/'app/assets/pets';self.assets.mkdir(parents=True)
        self.ns={'ROOT':self.root,'APP':self.app,'PET_ASSET_ROOT':self.assets,'Path':Path,'json':json,'quote':quote,'shutil':shutil,'tempfile':tempfile,
                 'PET_SLUG':re.compile(r'^[a-z0-9][a-z0-9-]{1,110}$'),'product':Settings(self.root),'pet_frame_map':lambda *a:[[0]]*9,
                 'PET_CATALOG_CACHE':{'status':'snapshot','checked_at':None},'pet_catalog':lambda *a:[],
                 'SOURCE_ROOT':self.base/'resources','vivi_pet':type('ViVi',(),{'SLUG':'vivi--durianloop','bundled_item':staticmethod(lambda *args:None)})(),
                 'pet_fetch_bytes':lambda *a:(_ for _ in ()).throw(AssertionError('reinstalling a bundled pet must stay offline'))}
        exec(code,self.ns)
    def tearDown(self):self.tmp.cleanup()
    def package(self,root,folder,slug):
        target=root/folder;target.mkdir(parents=True);(target/'pet.json').write_text(json.dumps({'id':slug,'displayName':folder}));(target/'spritesheet.webp').write_bytes(b'public-sprite');return target
    def test_bundled_removal_survives_restart_and_reseed_without_mutating_resources(self):
        bundle=self.package(self.app/'assets/pets','desk-otter','desk-otter--author');shutil.copytree(bundle,self.assets/'desk-otter')
        self.ns['product'].set_settings({'pet.active_slug':'desk-otter--author'},self.root)
        self.ns['uninstall_pet']('desk-otter--author');self.ns['product']=Settings(self.root)
        self.assertEqual(self.ns['pet_status']()['installed'],[]);self.assertEqual(self.ns['pet_status']()['active_slug'],'')
        self.assertEqual((bundle/'spritesheet.webp').read_bytes(),b'public-sprite')
        self.ns['install_pet']('desk-otter--author');self.assertEqual(self.ns['pet_status']()['active_slug'],'desk-otter--author')
    def test_active_removal_selects_remaining_then_all_empty(self):
        self.package(self.app/'assets/pets','desk-otter','desk-otter--author');download=self.package(self.assets,'download-cat','download-cat--author')
        self.ns['product'].set_settings({'pet.active_slug':'desk-otter--author'},self.root)
        self.ns['uninstall_pet']('desk-otter--author');self.assertEqual(self.ns['pet_status']()['active_slug'],'download-cat--author')
        self.ns['uninstall_pet']('download-cat--author');self.assertFalse(download.exists());self.assertEqual(self.ns['pet_status']()['active_slug'],'')
    def test_source_checkout_removal_preserves_asset_and_can_restore(self):
        self.ns['APP']=self.root/'app';asset=self.package(self.assets,'desk-otter','desk-otter--author')
        self.ns['uninstall_pet']('desk-otter--author');self.assertTrue(asset.exists());self.assertEqual(self.ns['pet_local_items'](),[])
        self.ns['install_pet']('desk-otter--author');self.assertEqual(len(self.ns['pet_local_items']()),1)
    def test_workspace_copy_wins_without_duplicate_bundled_entry(self):
        bundle=self.package(self.app/'assets/pets','desk-otter','desk-otter--author');shutil.copytree(bundle,self.assets/'desk-otter')
        self.assertEqual(len(self.ns['pet_local_items']()),1)

if __name__=='__main__':unittest.main()
