/* Minimal zero-dependency static file server for local preview.
   Usage: node serve.js  →  http://localhost:4173 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 4173;
const ROOT = __dirname;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8'
};

http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  let filePath = path.join(ROOT, path.normalize(urlPath).replace(/^(\.\.[\\/])+/, ''));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      const notFound = path.join(ROOT, '404.html');
      return fs.readFile(notFound, (e, buf) => {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(e ? 'Not found' : buf);
      });
    }
    fs.readFile(filePath, (e, buf) => {
      if (e) { res.writeHead(500); return res.end('Server error'); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
      res.end(buf);
    });
  });
}).listen(PORT, () => console.log('Symbiosis site running at http://localhost:' + PORT));
