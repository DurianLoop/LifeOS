from __future__ import annotations
import asyncio
from pathlib import Path
import queue
import sys
import traceback
from urllib.parse import urlparse

import toga
from toga.style import Pack
from lifeosmobile.runtime import MobileRuntime


class LifeOS(toga.App):
    def startup(self):
        self.platform = 'android' if sys.platform == 'android' else 'ios' if sys.platform == 'ios' else sys.platform
        self.runtime = None
        self.web = toga.WebView(style=Pack(flex=1), on_navigation_starting=self.navigate)
        self.web.user_agent = (self.web.user_agent or '') + f' LifeOSMobile/{self.platform}'
        self.main_window = toga.MainWindow(title='LifeOS')
        self.main_window.content = toga.Box(children=[self.web], style=Pack(direction='column', flex=1))
        self.main_window.show()
        if self.platform == 'android':
            from lifeosmobile.android_web import configure
            configure(self)

    async def on_running(self):
        try:
            self.runtime = MobileRuntime(self.paths.data, self.platform)
            url = await asyncio.to_thread(self.runtime.start)
            await self.web.load_url(url)
            await self.after_ready()
            while True:
                try:
                    operation, path, mime = self.runtime.commands.get_nowait()
                    if operation == 'export':
                        self.export(path, mime)
                    elif operation == 'restart':
                        self.web.url = 'about:blank'
                        url = await asyncio.to_thread(self.runtime.restart)
                        await self.web.load_url(url)
                except queue.Empty:
                    pass
                await asyncio.sleep(0.2)
        except Exception:
            traceback.print_exc()
            self.main_window.content = toga.Box(children=[
                toga.Label('LifeOS 未能启动。你的已有档案保留在本机，请重启应用或从备份恢复。', style=Pack(padding=24)),
            ])
            if getattr(self, 'testing', False):
                print('LIFEOS_NATIVE_QA_FAILED', flush=True)

    async def after_ready(self):
        pass

    def navigate(self, widget, url, **kwargs):
        parsed = urlparse(url)
        if self.runtime and parsed.scheme == 'http' and parsed.netloc == self.runtime.authority:
            return True
        if url == 'about:blank':
            return True
        if parsed.scheme in ('https', 'http', 'mailto'):
            if self.platform == 'android':
                from android.content import Intent
                from android.net import Uri
                self._impl.native.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
            elif self.platform == 'ios':
                from rubicon.objc import ObjCClass
                ObjCClass('UIApplication').sharedApplication.openURL_options_completionHandler_(
                    ObjCClass('NSURL').URLWithString(url), {}, None)
        return False

    def export(self, path: Path, mime: str):
        if self.platform == 'android':
            from android.content import Intent
            intent = Intent(Intent.ACTION_CREATE_DOCUMENT)
            intent.addCategory(Intent.CATEGORY_OPENABLE)
            intent.setType(mime)
            intent.putExtra(Intent.EXTRA_TITLE, path.name)

            def completed(result, data):
                if result != -1 or data is None:
                    return
                stream = self._impl.native.getContentResolver().openOutputStream(data.getData(), 'wt')
                try:
                    with path.open('rb') as source:
                        while chunk := source.read(65536):
                            stream.write(chunk)
                    stream.flush()
                finally:
                    stream.close()
            self._impl.start_activity(intent, on_complete=completed)
        elif self.platform == 'ios':
            from rubicon.objc import ObjCClass
            url = ObjCClass('NSURL').fileURLWithPath(str(path))
            controller = ObjCClass('UIActivityViewController').alloc().initWithActivityItems_applicationActivities_([url], None)
            root = self.main_window._impl.native.rootViewController
            if controller.popoverPresentationController:
                controller.popoverPresentationController.sourceView = root.view
                controller.popoverPresentationController.sourceRect = root.view.bounds
            root.presentViewController_animated_completion_(controller, True, None)


def main():
    return LifeOS('LifeOS', 'life.lifeos.lifeosmobile')
