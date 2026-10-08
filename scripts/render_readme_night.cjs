/** Render the README's night scenes with Electron. No app or personal workspace is opened.
 * Run: electron scripts/render_readme_night.cjs [--output path]
 */
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const option = process.argv.indexOf('--output');
const output = option >= 0 ? path.resolve(process.argv[option + 1]) : path.join(root, 'docs/images/readme/night');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'lifeos-night-render-')));
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.on('window-all-closed', () => {});
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

app.whenReady().then(async () => {
  fs.mkdirSync(output, { recursive: true });
  session.defaultSession.webRequest.onBeforeRequest((request, done) => {
    done({ cancel: !/^(file:|data:|about:)/.test(request.url) });
  });
  const report = [];
  for (const lang of ['zh', 'en']) {
    for (const mobile of [false, true]) {
      for (const scene of ['hero', 'memory', 'draw', 'letters', 'companion']) {
        const width = mobile ? 800 : 1600;
        const zoom = mobile ? 2 : 1;
        const win = new BrowserWindow({
          width, height: 1800, useContentSize: true, show: false,
          webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, zoomFactor: zoom }
        });
        const template = ['hero', 'memory'].includes(scene) ? 'readme-night.html' : 'readme-gallery.html';
        await win.loadFile(path.join(__dirname, template), { query: { lang, capture: scene } });
        await win.webContents.executeJavaScript('Promise.all([...document.images].map(i => i.decode())).then(() => document.fonts.ready)');
        const layout = await win.webContents.executeJavaScript(`(() => {
          const el = document.getElementById('${scene}-art');
          const rect = el.getBoundingClientRect();
          const img = el.querySelector('img'), box = img.getBoundingClientRect();
          return {viewport: innerWidth, width: rect.width, height: rect.height, scrollWidth: document.documentElement.scrollWidth,
            image: {file: img.getAttribute('src').split('/').pop(), x:box.x-rect.x, y:box.y-rect.y, width:box.width, height:box.height, naturalWidth:img.naturalWidth, naturalHeight:img.naturalHeight}};
        })()`);
        const i = layout.image;
        if (layout.scrollWidth > layout.viewport || i.x < 0 || i.y < 0 || i.x + i.width > layout.width + 1 || i.y + i.height > layout.height + 1 || Math.abs(i.width / i.height - i.naturalWidth / i.naturalHeight) > 0.002) {
          throw new Error(`Invalid scene layout: ${JSON.stringify(layout)}`);
        }
        const height = Math.ceil(layout.height * zoom);
        win.setContentSize(width, height);
        await win.webContents.executeJavaScript('scrollTo(0,0); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
        const image = await win.webContents.capturePage();
        const size = image.getSize();
        if (size.width !== width || size.height !== height) throw new Error(`Unexpected capture size ${JSON.stringify(size)}`);
        const file = `${scene}-${lang}${mobile ? '-mobile' : ''}.png`;
        fs.writeFileSync(path.join(output, file), image.toPNG());
        report.push({file, size, bytes: fs.statSync(path.join(output,file)).size, source: i.file, source_sha256: hash(path.join(root,'docs/images/readme',i.file)), layout});
        console.log(file, JSON.stringify(size));
        await win.loadURL('about:blank');
        win.webContents.stopPainting();
        win.destroy();
      }
    }
  }
  fs.writeFileSync(path.join(output, 'scenes.json'), JSON.stringify(report, null, 2) + '\n');
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
