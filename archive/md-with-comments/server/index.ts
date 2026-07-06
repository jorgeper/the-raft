import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'documents');
const DIST_DIR = path.join(ROOT, 'dist');

const PORT = Number(process.env.PORT ?? 8787);

const app = express();
app.use(express.json({ limit: '5mb' }));

/** Only allow simple markdown filenames — no path traversal. */
function safeMdName(name: string): string | null {
  if (!/^[A-Za-z0-9._ -]+\.md$/.test(name) || name.includes('..')) return null;
  return name;
}

app.get('/api/files', async (_req, res) => {
  const entries = await fs.readdir(DOCS_DIR);
  const files = entries.filter((f) => f.endsWith('.md')).sort();
  res.json({ files });
});

app.get('/api/files/:name', async (req, res) => {
  const name = safeMdName(req.params.name);
  if (!name) return res.status(400).json({ error: 'invalid file name' });
  try {
    const content = await fs.readFile(path.join(DOCS_DIR, name), 'utf8');
    res.json({ name, content });
  } catch {
    res.status(404).json({ error: 'not found' });
  }
});

app.get('/api/files/:name/comments', async (req, res) => {
  const name = safeMdName(req.params.name);
  if (!name) return res.status(400).json({ error: 'invalid file name' });
  try {
    const raw = await fs.readFile(path.join(DOCS_DIR, `${name}.comments.json`), 'utf8');
    res.json(JSON.parse(raw));
  } catch {
    res.json({ comments: [] });
  }
});

app.put('/api/files/:name/comments', async (req, res) => {
  const name = safeMdName(req.params.name);
  if (!name) return res.status(400).json({ error: 'invalid file name' });
  const body = req.body;
  if (!body || !Array.isArray(body.comments)) {
    return res.status(400).json({ error: 'body must be { comments: [...] }' });
  }
  const target = path.join(DOCS_DIR, `${name}.comments.json`);
  await fs.writeFile(target, JSON.stringify({ comments: body.comments }, null, 2) + '\n', 'utf8');
  res.json({ ok: true });
});

// Production: serve the built SPA.
app.use(express.static(DIST_DIR));
app.get(/^\/(?!api\/).*/, async (_req, res, next) => {
  try {
    await fs.access(path.join(DIST_DIR, 'index.html'));
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  } catch {
    next();
  }
});

app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});
