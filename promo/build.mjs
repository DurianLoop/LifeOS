import { copyFileSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Publish only the static website, never development notes or local services.
const root = dirname(fileURLToPath(import.meta.url));
const output = resolve(root, 'dist');
if (!output.startsWith(root + sep) || output !== resolve(root, 'dist')) {
  throw new Error('Invalid website output directory');
}
const files = [
  'index.html', '_headers', 'robots.txt', 'sitemap.xml',
  'styles.css', 'product.css', 'icons.css', 'motion.css', 'navigation.css', 'branding.css',
  'app.js', 'universe.js', 'motion.js', 'navigation.js',
  'assets/credits.html', 'assets/forest.ogg',
  'assets/brand/lifeos-icon-32.png', 'assets/brand/lifeos-icon-128.png',
  'assets/brand/lifeos-icon-256.png', 'assets/brand/lifeos-pages.gif',
  'assets/vivi-preview.png', 'assets/vivi-sit.gif', 'assets/vivi-jump.gif',
  'assets/vivi-relax.gif', 'assets/vivi-LICENSE.md',
  'assets/screens/workspace.png', 'assets/screens/memory.jpg',
  'assets/screens/bottles.jpg', 'assets/screens/companion.png',
  'app/index.html', 'app/model.js',
  'app/sw.js', 'app/manifest.webmanifest', 'app/icons/icon-192.png',
  'app/icons/icon-512.png', 'app/icons/icon-maskable.png', 'app/icons/apple-touch-icon.png',
  'app/pocket.js', 'app/pocket.css', 'app/paper-grain.svg', 'app/fonts/lifeos-book-serif.woff2', 'app/fonts/OFL.txt', 'app/fonts/SOURCE.json', 'app/domain.js', 'app/workspace.js',
  'app/transfer.js', 'app/views.js', 'app/questions.js', 'app/companion.js', 'app/media/poems.json',
  ...['rain','fire','ocean','forest','stream','night'].flatMap(name => ['ogg','m4a'].map(ext=>`app/media/audio/${name}.${ext}`)),
  'app/media/audio/ATTRIBUTION.html', 'app/media/audio/SOURCES.json', 'app/media/vivi/LICENSE.md',
  ...['sit','move','sleep','jump','relax','interact','start','sweat','hide','fly','die','special','special0','special1'].map(name => `app/media/vivi/${name}.gif`),
  'app/media/dsh/catalog.json','app/media/dsh/NOTICE.md',
  ...JSON.parse(readFileSync(resolve(root,'app/media/dsh/catalog.json'),'utf8')).actions.map(row=>`app/media/dsh/${row.file}`),
];
rmSync(output, { recursive: true, force: true });
for (const file of files) {
  const target = resolve(output, file);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(resolve(root, file), target);
}
const appVersion = createHash('sha256');
for (const file of files.filter(file => file.startsWith('app/'))) appVersion.update(file).update(readFileSync(resolve(root, file)));
const worker = readFileSync(resolve(output, 'app/sw.js'), 'utf8');
writeFileSync(resolve(output, 'app/sw.js'), worker.replace(/lifeos-pocket-v1/, `lifeos-pocket-${appVersion.digest('hex').slice(0, 12)}`));
console.log(`Built ${files.length} public website files in ${output}`);
