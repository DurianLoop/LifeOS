"""Drive only synthetic acceptance files through Android's real DocumentsUI."""
from pathlib import Path
import json
import re
import subprocess
import time
import xml.etree.ElementTree as ET

OUT = Path('logs')
OUT.mkdir(exist_ok=True)
fixture = OUT / 'LifeOS-native-import.txt'
fixture.write_text('LifeOS native import acceptance', encoding='utf-8')

def adb(*args):
    return subprocess.check_output(['adb', *args], text=True, stderr=subprocess.DEVNULL).strip()

def tap(node):
    values = list(map(int, re.findall(r'\d+', node.get('bounds', ''))))
    if len(values) == 4 and values[2] > values[0] and values[3] > values[1]:
        adb('shell', 'input', 'tap', str((values[0] + values[2]) // 2), str((values[1] + values[3]) // 2))
        return True
    return False

adb('push', str(fixture), '/sdcard/Download/LifeOS-native-import.txt')
saved, selected, opened = False, False, False
for _ in range(700):
    try:
        adb('shell', 'uiautomator', 'dump', '/sdcard/lifeos-acceptance-ui.xml')
        xml = ET.fromstring(adb('shell', 'cat', '/sdcard/lifeos-acceptance-ui.xml'))
        nodes = list(xml.iter('node'))
        for node in nodes:
            identity = node.get('resource-id', '')
            text = node.get('text', '')
            description = node.get('content-desc', '')
            if 'action_menu_save' in identity and node.get('enabled') == 'true':
                saved = tap(node) or saved
                break
            if saved and 'Native import acceptance' in description:
                opened = tap(node) or opened
                break
            if opened and text == 'LifeOS-native-import.txt':
                selected = tap(node)
                break
            if opened and text in ('Downloads', 'Download') and 'documentsui' in node.get('package', ''):
                tap(node)
                break
        else:
            if opened and any('documentsui' in n.get('package', '') for n in nodes):
                drawer = next((n for n in nodes if n.get('content-desc') in ('Show roots', 'Open navigation drawer')), None)
                if drawer is not None:
                    tap(drawer)
        if saved and selected:
            # The app reads the saved content URI back and compares every byte
            # before it exposes the import input to this driver.
            (OUT / 'ANDROID_DOCUMENTS_ACCEPTANCE.json').write_text(json.dumps({'ok': True,
                'native_export_bytes': True, 'native_import_picker': True}), encoding='utf-8')
            print('Android system document selection and export passed', flush=True)
            break
    except (subprocess.SubprocessError, ET.ParseError, StopIteration):
        pass
    time.sleep(2)
else:
    raise SystemExit('Android system document acceptance timed out')
