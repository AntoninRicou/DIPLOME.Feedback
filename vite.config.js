import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

const datasDir = path.resolve(__dirname, 'datas');
// The atlas lives in the sibling "process" repo. On a fresh clone that folder
// may carry its GitHub name (DIPLOME.ProcessData) instead — accept either.
const cacheDir =
  ['../DIPLOME.ProcessData/cache', '../DIPLOME.ProcessData/cache']
    .map((p) => path.resolve(__dirname, p))
    .find((p) => fs.existsSync(p)) || path.resolve(__dirname, '../DIPLOME.ProcessData/cache');

function serveStaticDir(urlPrefix, rootDir, name) {
  return {
    name,
    configureServer(server) {
      server.middlewares.use(urlPrefix, (req, res, next) => {
        const rel = decodeURIComponent((req.url || '/').split('?')[0]);
        const filePath = path.join(rootDir, rel);
        if (!filePath.startsWith(rootDir)) return next();
        fs.stat(filePath, (err, stat) => {
          if (err || !stat.isFile()) return next();
          const ext = path.extname(filePath).toLowerCase();
          const types = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.webp': 'image/webp',
            '.json': 'application/json',
          };
          res.setHeader('Content-Type', types[ext] || 'application/octet-stream');
          fs.createReadStream(filePath).pipe(res);
        });
      });
    },
  };
}

export default defineConfig({
  publicDir: 'static',
  plugins: [
    serveStaticDir('/datas', datasDir, 'serve-datas'),
    serveStaticDir('/atlas', cacheDir, 'serve-atlas'),
  ],
});
