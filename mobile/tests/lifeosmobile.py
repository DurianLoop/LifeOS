"""Exercise the real platform WebView and the embedded offline engine."""
import asyncio
import json
import traceback
import base64
import http.cookiejar
import io
import urllib.request
from lifeosmobile.app import LifeOS


class AcceptanceApp(LifeOS):
    testing = True

    async def js(self, code):
        # WKWebView can return NSNull / NSDictionary wrappers. A JSON string
        # gives both native engines the same Python primitives, including null.
        value = await self.web.evaluate_javascript(
            'JSON.stringify({value:(0,eval)(' + json.dumps(code) + ')})')
        return json.loads(value).get('value')

    async def wait_js(self, expression, seconds=30):
        for _ in range(seconds * 5):
            value = await self.js(expression)
            if value:
                return value
            await asyncio.sleep(0.2)
        raise AssertionError('Timed out: ' + expression)

    def check_native_data(self, entry):
        """Use the shipped native crypto/image wheels and real offline APIs."""
        from engine import crypto_vault
        import qrcode
        client = urllib.request.build_opener(urllib.request.ProxyHandler({}),
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        client.open(self.runtime.url).close()

        def request(path, body=None):
            data = None if body is None else json.dumps(body).encode()
            with client.open(urllib.request.Request(self.runtime.origin + path, data=data,
                    headers={'Content-Type': 'application/json'}), timeout=60) as response:
                content = response.read()
                return json.loads(content) if 'application/json' in response.headers.get('Content-Type', '') else content

        content = b'Native attachment roundtrip\x00\xff'
        attached = request('/api/attachments', {'entry_id': entry, 'name': 'acceptance.bin',
                           'data_base64': base64.b64encode(content).decode()})
        assert request('/api/attachment?attachment_id=' + attached['attachment']['attachment_id']) == content
        crypto_vault.create_recovery_key(self.runtime.root)
        envelope = crypto_vault.encrypt_json({'text': '原生加密'}, {'entry_id': entry}, self.runtime.root)
        assert crypto_vault.decrypt_json(envelope, self.runtime.root) == {'text': '原生加密'}
        image = io.BytesIO()
        qrcode.make('LifeOS native QR acceptance').save(image, format='PNG')
        assert image.getvalue().startswith(b'\x89PNG')
        backup = request('/api/backups/create', {'reason': 'native acceptance'})
        request('/api/entries/save', {'journal_date': '2026-10-02', 'sections': {'日记': 'Restore must remove this extra page.'}})
        assert request('/api/backups/restore', {'backup_id': backup['backup_id']})['restart_required']
        self.runtime.restart()
        return ['native AES-GCM', 'native Pillow QR', 'attachment bytes', 'backup restore', 'full engine restart']

    async def after_ready(self):
        try:
            await self.wait_js('!!window.lifeosMobile && typeof openFeature === "function" && !!window.lifeosJournalBook')
            assert await self.js('window.lifeosMobile.platform') == self.platform
            await self.js("window.__qaText=null;lifeosMobile.requestText('输入验收','原生输入').then(value=>window.__qaText={value});null")
            await self.wait_js('!!document.querySelector(".mobileTextDialog[open]")')
            await self.js("document.querySelector('.mobileTextDialog button[type=submit]').click();null")
            assert (await self.wait_js('window.__qaText'))['value'] == '原生输入'
            await self.js("document.querySelector('[data-welcome=skip]')?.click(); localStorage.setItem('lifeos.qa.restart','native-persistence'); null")
            await self.js("window.__qa=null;fetch('/api/entries/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({journal_date:'2026-10-01',title:'Native acceptance fixture',sections:{'日记':'Offline native acceptance. 本地日记，重启后仍然保存。'}})}).then(r=>r.json()).then(r=>window.__qa=r).catch(e=>window.__qa={error:String(e)});null")
            saved = await self.wait_js('window.__qa')
            assert saved.get('ok'), saved
            entry = saved['result']['entry_id']
            # Exercise the new mobile directory rather than only rendering pages.
            await self.js('lifeosMobile.openLibrary();null')
            assert await self.js('document.querySelector("#mobileLibrary").open')
            await self.js('document.querySelector("[data-category=全部]").click();null')
            assert await self.js('document.querySelectorAll(".mobileLibraryRow").length') == await self.js('FEATURES.length')
            await self.js('document.querySelector(".mobileLibrarySearch").value="备份";document.querySelector(".mobileLibrarySearch").dispatchEvent(new Event("input"));null')
            assert '备份与恢复' in await self.js('document.querySelector(".mobileLibraryResults").innerText')
            await self.js('document.querySelector("#mobileLibrary").close();null')
            # Actual rendering of every original feature plus the added poetry page.
            names = await self.js('FEATURES.map(x=>x.name)')
            assert len(names) >= 142, names
            rendered = []
            for name in names:
                if name == 'Ask My Life':
                    await self.js('openAsk();null')
                    await self.wait_js('document.querySelector("#askModal").classList.contains("open")')
                    await self.js('document.querySelector("#askModal").classList.remove("open");null')
                    rendered.append(name)
                    continue
                await self.js('openFeature(' + json.dumps(name) + ');null')
                await self.wait_js('!document.querySelector("#view .loading")')
                await asyncio.sleep(0.15)
                result = await self.js('JSON.stringify({page:STATE.feature,text:document.querySelector("#view").innerText,overflow:document.documentElement.scrollWidth-innerWidth})')
                result = json.loads(result)
                assert result['page'] == ('Attic' if name == 'Other' else name) and result['text'].strip(), result
                assert 'Could not render this module' not in result['text'], result
                assert result['overflow'] <= 4, (name, result['overflow'])
                rendered.append(name)
            for name in ('Attic', 'Attic Review', 'Attic Organize', 'Attic Observe', 'AI Settings', 'Serendipity'):
                await self.js('openFeature(' + json.dumps(name) + ');null')
                await self.wait_js('!document.querySelector("#view .loading")')
                rendered.append(name)
            await self.js("window.dispatchEvent(new Event('lifeos:open-pet'));null")
            await self.wait_js('!!document.querySelector("#petSettingsToggle")')
            # Decode every original DSH action in the actual OS WebView. iOS
            # uses generated transparent atlases; Android uses the source VP9.
            await self.js("window.__qaPetReady=false;fetch('/assets/pets/dsh-pet/pet.json').then(r=>r.json()).then(m=>{window.__qaPetManifest=m;const host=document.createElement('div');document.body.append(host);window.__qaPet=lifeosDSH.mount(host,{...m,manifest_url:location.origin+'/assets/pets/dsh-pet/pet.json'},{motion:false});return __qaPet.ready}).then(()=>window.__qaPetReady=true).catch(e=>window.__qaPetReady=String(e));null")
            assert await self.wait_js('window.__qaPetReady') is True
            actions = await self.js('__qaPetManifest.actions.map(x=>x.id)')
            assert len(actions) == 106
            for action in actions:
                await self.js("window.__qaAction=null;__qaPet.select(" + json.dumps(action) + ",{loop:true}).then(ok=>window.__qaAction={ok}).catch(e=>window.__qaAction={error:String(e)});null")
                result = await self.wait_js('window.__qaAction')
                assert result.get('ok'), (action, result)
            await self.js("window.__qaAlpha=(()=>{const source=__qaPet.element.querySelector('.dshPetVideo:not([hidden])'),canvas=document.createElement('canvas');canvas.width=source.videoWidth;canvas.height=source.videoHeight;const context=canvas.getContext('2d');context.drawImage(source,0,0);const data=context.getImageData(0,0,canvas.width,canvas.height).data;let transparent=0,visible=0;for(let i=3;i<data.length;i+=4){if(data[i]===0)transparent++;if(data[i]>0)visible++}return{transparent,visible}})();null")
            alpha = await self.js('window.__qaAlpha')
            assert alpha['transparent'] > alpha['visible'] * 0.1 and alpha['visible'] > 0, alpha
            await self.js('__qaPet.destroy();null')
            # A native document export opens the real platform sheet. Android
            # CI's accessibility driver saves it through DocumentsUI.
            export = self.paths.data / 'LifeOS-native-export.txt'
            export.write_text('LifeOS native export acceptance', encoding='utf-8')
            self.export(export, 'text/plain')
            if self.platform == 'ios':
                for _ in range(50):
                    if self._share_controller.presentingViewController is not None:
                        break
                    await asyncio.sleep(0.2)
                assert self._share_controller.presentingViewController is not None
                self._share_controller.dismissViewControllerAnimated_completion_(True, None)
                await asyncio.sleep(0.5)
            else:
                for _ in range(300):
                    if getattr(self, '_last_export_completed', None) == export.name:
                        break
                    await asyncio.sleep(0.2)
                else:
                    raise AssertionError('Native document provider did not finish export')
                # The driver taps a real HTML input, then selects a synthetic
                # document from the Android system picker.
                await self.js("window.__qaImport=null;const input=document.createElement('input');input.type='file';input.accept='.txt';input.id='qaNativeImport';input.setAttribute('aria-label','Native import acceptance');input.style='position:fixed;inset:80px 10px auto;z-index:99999;background:white';input.onchange=()=>input.files[0].text().then(text=>window.__qaImport=text);document.body.append(input);null")
                assert await self.wait_js('window.__qaImport', seconds=60) == 'LifeOS native import acceptance'
                await self.js("document.querySelector('#qaNativeImport').remove();null")
                await self.js('openAsk();null')
                self.back_callback.run()
                await self.wait_js('!document.querySelector("#askModal.open")')
            # Recreate WebView origin session; durable state is outside Web storage.
            self.web.url = None
            await asyncio.sleep(0.3)
            native_checks = await asyncio.to_thread(self.check_native_data, entry)
            self.web.url = self.runtime.url
            await self.wait_js('location.origin===' + json.dumps(self.runtime.origin) + ' && !!window.lifeosMobile && !!window.lifeosStorage')
            assert await self.js("localStorage.getItem('lifeos.qa.restart')") == 'native-persistence'
            await self.js("window.__qa=null;fetch('/api/entries').then(r=>r.json()).then(r=>window.__qa=r);null")
            entries = await self.wait_js('window.__qa')
            assert len(entries['items']) == 1 and entries['items'][0]['title'] == 'Native acceptance fixture', entries
            report = {'ok': True, 'platform': self.platform, 'pages': rendered,
                      'native_webview': True, 'embedded_python': True,
                      'offline_save': True, 'origin_independent_drafts': True,
                      'dsh_actions_decoded': len(actions), 'dsh_transparency': alpha,
                      'native_data_checks': native_checks, 'native_export_sheet': True,
                      'native_import_picker': self.platform == 'android'}
            target = self.paths.data / 'NATIVE_ACCEPTANCE.json'
            target.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
            print('LIFEOS_ACCEPTANCE_REPORT=' + json.dumps(report), flush=True)
            print('LIFEOS_NATIVE_QA_PASSED', flush=True)
            print('>>>>>>>>>> EXIT 0 <<<<<<<<<<', flush=True)
        except Exception:
            traceback.print_exc()
            print('LIFEOS_NATIVE_QA_FAILED', flush=True)
            print('>>>>>>>>>> EXIT 1 <<<<<<<<<<', flush=True)
        self.exit()


if __name__ == '__main__':
    AcceptanceApp('LifeOS', 'life.lifeos.lifeosmobile').main_loop()
