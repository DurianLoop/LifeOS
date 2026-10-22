"""Exercise the real platform WebView and the embedded offline engine."""
import asyncio
import json
import traceback
from lifeosmobile.app import LifeOS


class AcceptanceApp(LifeOS):
    testing = True

    async def js(self, code):
        return await self.web.evaluate_javascript(code)

    async def wait_js(self, expression, seconds=30):
        for _ in range(seconds * 5):
            value = await self.js(expression)
            if value:
                return value
            await asyncio.sleep(0.2)
        raise AssertionError('Timed out: ' + expression)

    async def after_ready(self):
        try:
            await self.wait_js('!!window.lifeosMobile && typeof openFeature === "function" && !!window.lifeosJournalBook')
            assert await self.js('window.lifeosMobile.platform') == self.platform
            await self.js("document.querySelector('[data-welcome=skip]')?.click(); localStorage.setItem('lifeos.qa.restart','native-persistence'); null")
            await self.js("window.__qa=null;fetch('/api/entries/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({journal_date:'2026-10-01',title:'Native acceptance fixture',sections:{'日记':'Offline native acceptance. 本地日记，重启后仍然保存。'}})}).then(r=>r.json()).then(r=>window.__qa=r).catch(e=>window.__qa={error:String(e)});null")
            saved = await self.wait_js('window.__qa')
            assert saved.get('ok'), saved
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
            # Recreate WebView origin session; durable state is outside Web storage.
            await self.web.load_url(self.runtime.url)
            await self.wait_js('!!window.lifeosMobile && !!window.lifeosStorage')
            assert await self.js("localStorage.getItem('lifeos.qa.restart')") == 'native-persistence'
            await self.js("window.__qa=null;fetch('/api/entries').then(r=>r.json()).then(r=>window.__qa=r);null")
            entries = await self.wait_js('window.__qa')
            assert any(x.get('title') == 'Native acceptance fixture' for x in entries['items']), entries
            report = {'ok': True, 'platform': self.platform, 'pages': rendered,
                      'native_webview': True, 'embedded_python': True,
                      'offline_save': True, 'origin_independent_drafts': True}
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
