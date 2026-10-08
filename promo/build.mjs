import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
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
];
rmSync(output, { recursive: true, force: true });
for (const file of files) {
  const target = resolve(output, file);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(resolve(root, file), target);
}
console.log(`Built ${files.length} public website files in ${output}`);
