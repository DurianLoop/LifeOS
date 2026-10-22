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

adb('wait-for-device')
for attempt in range(30):
    try:
        adb('shell', 'mkdir', '-p', '/sdcard/Download')
        adb('push', str(fixture), '/sdcard/Download/LifeOS-native-import.txt')
        print('Synthetic document available in Downloads', flush=True)
        break
    except subprocess.SubprocessError:
        if attempt == 29:
            raise
        time.sleep(2)
saved, selected, opened = False, False, False
for _ in range(700):
    try:
        adb('shell', 'uiautomator', 'dump', '/sdcard/lifeos-acceptance-ui.xml')
        xml = ET.fromstring(adb('shell', 'cat', '/sdcard/lifeos-acceptance-ui.xml'))
        (OUT / 'android-documents-ui.xml').write_bytes(ET.tostring(xml))
        nodes = list(xml.iter('node'))
        save = next((n for n in nodes if ('action_menu_save' in n.get('resource-id', '')
            or n.get('text', '').upper() == 'SAVE') and n.get('enabled') == 'true'), None)
        choose = next((n for n in nodes if 'Native import acceptance' in
            n.get('text', '') + n.get('content-desc', '')), None)
        # A file card has a separate preview button whose accessibility label
        # also contains the filename. Select the filename, never that button.
        item = next((n for n in nodes if 'LifeOS-native-im' in n.get('text', '')
            and n.get('resource-id', '').endswith(':id/title')), None)
        if save is not None:
            saved = tap(save) or saved
            print('Tapped native save', flush=True)
        elif saved and choose is not None:
            opened = tap(choose) or opened
            print('Opened native import picker', flush=True)
        elif opened and item is not None:
            selected = tap(item)
        elif opened and any('documentsui' in n.get('package', '') for n in nodes):
            downloads = next((n for n in nodes if n.get('text') in ('Downloads', 'Download')
                and n.get('clickable') == 'true'), None)
            drawer = next((n for n in nodes if n.get('content-desc') in
                ('Show roots', 'Open navigation drawer')), None)
            if downloads is not None:
                tap(downloads)
            elif drawer is not None:
                tap(drawer)
        if saved and selected and not any('documentsui' in n.get('package', '') for n in nodes):
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
