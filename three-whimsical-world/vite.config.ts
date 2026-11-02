import { defineConfig, type Plugin } from 'vite';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * Saves photos straight into a folder on this machine (default ~/Downloads), which a page can't do on its own:
 * photo mode and photo sessions POST their PNGs here. Dev server only; a static build falls back to browser downloads.
 *
 *   POST /__photos/save?dir=~/Downloads&sub=meadows-photos-...&name=01-....png   (body: the PNG)
 *   POST /__photos/pick   → a native "choose folder" dialog (macOS), answers { dir }
 *
 * Only same-origin requests are accepted (another site in the browser can't write files through it), and only into
 * the home folder or an external drive under /Volumes.
 */
function photoSaver(): Plugin {
  const home = os.homedir();
  const expand = (dir: string) => path.resolve(dir.replace(/^~(?=$|\/)/, home));
  const allowed = (dir: string) => dir === home || dir.startsWith(home + path.sep) || dir.startsWith('/Volumes/');
  const clean = (s: string) => s.replace(/[^\w.-]+/g, '-').replace(/^[.-]+/, '').slice(0, 120);
  const pretty = (p: string) => (p.startsWith(home) ? '~' + p.slice(home.length) : p);
  return {
    name: 'photo-saver',
    configureServer(server) {
      server.middlewares.use('/__photos', (req, res) => {
        const reply = (code: number, body: object) => {
          res.statusCode = code;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(body));
        };
        if (req.method !== 'POST') return reply(405, { error: 'POST only' });
        if (req.headers.origin !== `http://${req.headers.host}`) return reply(403, { error: 'same-origin only' });
        const url = new URL(req.url ?? '/', 'http://x');
        if (url.pathname === '/pick') {
          if (process.platform !== 'darwin') return reply(501, { error: 'folder picker needs macOS' });
          const script = 'POSIX path of (choose folder with prompt "Save Meadows photos to:" default location (path to downloads folder))';
          execFile('osascript', ['-e', script], (err, out) => {
            if (err) return reply(200, { cancelled: true });
            reply(200, { dir: pretty(out.trim().replace(/\/$/, '')) });
          });
          return;
        }
        if (url.pathname !== '/save') return reply(404, { error: 'unknown' });
        const dir = expand(url.searchParams.get('dir') || '~/Downloads');
        const sub = clean(url.searchParams.get('sub') ?? '');
        const name = clean(url.searchParams.get('name') ?? '');
        if (!allowed(dir)) return reply(400, { error: `can only save under ${home} or /Volumes` });
        if (!name.endsWith('.png')) return reply(400, { error: 'name must end in .png' });
        const chunks: Buffer[] = [];
        let size = 0;
        req.on('data', (c: Buffer) => {
          size += c.length;
          if (size > 80e6) req.destroy();
          else chunks.push(c);
        });
        req.on('end', async () => {
          const png = Buffer.concat(chunks);
          if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return reply(400, { error: 'not a PNG' });
          try {
            const folder = sub ? path.join(dir, sub) : dir;
            await fs.mkdir(folder, { recursive: true });
            const file = path.join(folder, name);
            await fs.writeFile(file, png);
            reply(200, { path: pretty(file) });
          } catch (e) {
            reply(500, { error: String(e) });
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [photoSaver()],
});
