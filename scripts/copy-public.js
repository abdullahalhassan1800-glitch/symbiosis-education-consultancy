'use strict';
/* Stages the public website files into `public/` for Vercel's static output.
 *
 * GitHub Pages serves these files from the repository root, so they stay at the
 * root. Vercel, however, needs an explicit static output directory; vercel.json
 * sets `outputDirectory: "public"` and this script fills it during the build.
 * `public/` is git-ignored (see .gitignore).
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'public');

const files = [
  'index.html',
  'privacy.html',
  'terms.html',
  '404.html',
  'robots.txt',
  'sitemap.xml',
  'mobile-preview.html',
  '.nojekyll',
];
const dirs = ['css', 'js', 'assets'];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

for (const f of files) {
  const src = path.join(root, f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(out, f));
}
for (const d of dirs) {
  const src = path.join(root, d);
  if (fs.existsSync(src)) fs.cpSync(src, path.join(out, d), { recursive: true });
}

console.log('staged public site into public/');
