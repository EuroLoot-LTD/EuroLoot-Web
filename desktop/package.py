"""Package official Electron archives. Run once per native GitHub Actions runner."""
import hashlib, json, os, platform, shutil, subprocess, sys, urllib.request, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSION = '45.4.1'
SYSTEM = {'Darwin': 'darwin', 'Windows': 'win32', 'Linux': 'linux'}[platform.system()]
ARCH = 'arm64' if platform.machine().lower() in ('arm64','aarch64') else 'x64'
TARGET = ROOT / 'artifacts' / (SYSTEM + '-' + ARCH)
TARGET.mkdir(parents=True, exist_ok=True)
ARCHIVE = 'electron-v' + VERSION + '-' + SYSTEM + '-' + ARCH + '.zip'
API = 'https://api.github.com/repos/electron/electron/releases/tags/v' + VERSION
headers = {'User-Agent':'EuroLoot-packaging','Accept':'application/vnd.github+json'}
if os.environ.get('GITHUB_TOKEN'):
    headers['Authorization'] = 'Bearer ' + os.environ['GITHUB_TOKEN']
with urllib.request.urlopen(urllib.request.Request(API, headers=headers), timeout=60) as r:
    release = json.load(r)
asset = next(x for x in release['assets'] if x['name'] == ARCHIVE)
expected = asset.get('digest', '')
if not expected.startswith('sha256:'):
    raise RuntimeError('The official release has no SHA-256 digest')
archive = TARGET / ARCHIVE
with urllib.request.urlopen(asset['browser_download_url'], timeout=120) as r, archive.open('wb') as f:
    shutil.copyfileobj(r, f)
with archive.open('rb') as f:
    if hashlib.file_digest(f,'sha256').hexdigest() != expected[7:]:
        raise RuntimeError('Runtime checksum mismatch')
runtime = TARGET / 'runtime'
runtime.mkdir(exist_ok=True)
if SYSTEM == 'darwin':
    subprocess.run(['ditto','-x','-k',archive,runtime],check=True)
elif SYSTEM == 'linux':
    subprocess.run(['unzip','-q',archive,'-d',runtime],check=True)
else:
    with zipfile.ZipFile(archive) as z:
        z.extractall(runtime)
archive.unlink()
if SYSTEM == 'darwin':
    app = runtime / 'EuroLoot.app'
    (runtime / 'Electron.app').rename(app)
    resources = app / 'Contents/Resources'
    executable = app / 'Contents/MacOS/Electron'
else:
    resources = runtime / 'resources'
    old = runtime / ('electron.exe' if SYSTEM == 'win32' else 'electron')
    executable = runtime / ('EuroLoot.exe' if SYSTEM == 'win32' else 'euroloot')
    old.rename(executable)
(resources / 'default_app.asar').unlink(missing_ok=True)
bundle = resources / 'app'
bundle.mkdir(exist_ok=True)
for name in ['server','scripts','dist','db','fixtures']:
    shutil.copytree(ROOT/name,bundle/name,dirs_exist_ok=True)
(bundle/'desktop').mkdir(exist_ok=True)
shutil.copy2(ROOT/'desktop/main.cjs',bundle/'desktop/main.cjs')
shutil.copy2(ROOT/'LICENSE',bundle/'LICENSE')
(bundle/'package.json').write_text(json.dumps({'name':'euroloot-staging','productName':'EuroLoot Staging','version':'0.1.0','main':'desktop/main.cjs','type':'module'}))
if SYSTEM == 'darwin':
    import plistlib
    file = app/'Contents/Info.plist'
    with file.open('rb') as f:
        info=plistlib.load(f)
    info.update(CFBundleIdentifier='dev.euroloot.staging',CFBundleName='EuroLoot',CFBundleDisplayName='EuroLoot Staging')
    with file.open('wb') as f:
        plistlib.dump(info,f)
    subprocess.run(['codesign','--force','--deep','--sign','-',app],check=True)
    subprocess.run(['codesign','--verify','--deep','--strict',app],check=True)
command = [str(executable),'--euroloot-smoke']
if SYSTEM == 'linux':
    command = ['xvfb-run','-a'] + command
if '--skip-smoke' not in sys.argv:
    marker=TARGET/'smoke-ok'
    marker.unlink(missing_ok=True)
    check=subprocess.run(command,env={**os.environ,'EUROLOOT_SMOKE_RESULT':str(marker)},stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=90)
    print(check.stdout)
    if check.returncode or not marker.is_file() or marker.read_text()!='passed':
        raise RuntimeError('Packaged application failed launch verification')
out = ROOT/'artifacts'/'packages'
out.mkdir(exist_ok=True)
if SYSTEM == 'darwin':
    package=out/('EuroLoot-macOS-'+ARCH+'.zip')
    subprocess.run(['ditto','-c','-k','--sequesterRsrc','--keepParent',app,package],check=True)
elif SYSTEM == 'win32':
    package=out/'EuroLoot-Windows-x64.zip'
    shutil.make_archive(str(package.with_suffix('')),'zip',runtime)
else:
    pkg = TARGET/'debian'
    shutil.copytree(runtime,pkg/'opt/euroloot',dirs_exist_ok=True)
    desktop=pkg/'usr/share/applications';desktop.mkdir(parents=True,exist_ok=True)
    (desktop/'euroloot.desktop').write_text('[Desktop Entry]\nName=EuroLoot Staging\nType=Application\nExec=/opt/euroloot/euroloot\nIcon=/opt/euroloot/resources/app/dist/desktop-icon-512.png\nCategories=Game;\n')
    control=pkg/'DEBIAN';control.mkdir(exist_ok=True)
    (control/'control').write_text('Package: euroloot-staging\nVersion: 0.1.0\nSection: games\nPriority: optional\nArchitecture: amd64\nMaintainer: EuroLoot\nDepends: libgtk-3-0 | libgtk-3-0t64, libnss3, libasound2 | libasound2t64, libgbm1, libxss1\nDescription: EuroLoot local retail staging client\n')
    # Chromium uses the distro user-namespace sandbox or its official root-owned sandbox helper.
    (pkg/'opt/euroloot/chrome-sandbox').chmod(0o4755)
    package=out/'EuroLoot-Linux-amd64.deb'
    subprocess.run(['dpkg-deb','-Zgzip','-z3','--root-owner-group','--build',pkg,package],check=True)
with package.open('rb') as f:
    (out/(package.name+'.sha256')).write_text(hashlib.file_digest(f,'sha256').hexdigest()+'  '+package.name+'\n')
print(package)
