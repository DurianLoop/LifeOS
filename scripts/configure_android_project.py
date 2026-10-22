"""Install the audited Java adapter after Briefcase generates its project."""
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
project = ROOT / 'mobile/build/lifeosmobile/android/gradle/app/src/main'
if not (project / 'AndroidManifest.xml').is_file():
    raise SystemExit('Run briefcase create android before configuring the project')
target = project / 'java/life/lifeos/nativebridge/LifeOSBackCallback.java'
target.parent.mkdir(parents=True, exist_ok=True)
shutil.copyfile(ROOT / 'mobile/platform/android/LifeOSBackCallback.java', target)
print('Android system back adapter installed')
