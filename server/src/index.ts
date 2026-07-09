import express, { Response } from 'express';
import cors from 'cors';
import { execFile } from 'child_process';
import { promises as fs, watch, Stats } from 'fs';
import { dirname, join, resolve } from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const app = express();
const PORT = 3001;

const REPO_ROOT = resolve(__dirname, '..', '..');
const BUILD_SH = join(REPO_ROOT, 'build.sh');
const PDF_OUT_DIR = join(REPO_ROOT, 'out');

const DOCS_ROOT = resolve(process.env.DOCS_ROOT ?? join(REPO_ROOT, 'docs'));
const HISTORY_DIRNAME = '.history';

// NOTE: this logic mirrors mcp/src/index.ts. Two consumers, one filesystem —
// duplicated by design (different module systems make sharing costlier than
// the ~50 LOC saved). Keep both copies in sync if you change behaviour.

function safePath(rel: string): string {
  if (typeof rel !== 'string') throw new Error('path must be a string');
  const abs = resolve(DOCS_ROOT, rel);
  if (abs !== DOCS_ROOT && !abs.startsWith(DOCS_ROOT + '/')) {
    throw new Error(`Path outside DOCS_ROOT: ${rel}`);
  }
  return abs;
}

type TreeNode = {
  name: string;
  type: 'dir' | 'file';
  path: string;
  children?: TreeNode[];
};

async function listDocs(rel = ''): Promise<TreeNode[]> {
  const abs = safePath(rel);
  const entries = await fs.readdir(abs, { withFileTypes: true });
  const visible = entries.filter(
    (e) =>
      !e.name.startsWith('.') &&
      e.name !== HISTORY_DIRNAME &&
      (e.isDirectory() || e.name.endsWith('.md')),
  );
  return Promise.all(
    visible.map(async (e) => {
      const childRel = rel ? join(rel, e.name) : e.name;
      const node: TreeNode = {
        name: e.name,
        type: e.isDirectory() ? 'dir' : 'file',
        path: childRel,
      };
      if (e.isDirectory()) node.children = await listDocs(childRel);
      return node;
    }),
  );
}

async function snapshotIfExists(rel: string): Promise<void> {
  const abs = safePath(rel);
  let current: string;
  try {
    current = await fs.readFile(abs, 'utf8');
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw e;
  }
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const histDir = join(DOCS_ROOT, HISTORY_DIRNAME, rel);
  await fs.mkdir(histDir, { recursive: true });
  await fs.writeFile(join(histDir, `${ts}.md`), current, 'utf8');
}

async function listHistory(rel: string): Promise<string[]> {
  safePath(rel);
  const histDir = join(DOCS_ROOT, HISTORY_DIRNAME, rel);
  try {
    const entries = await fs.readdir(histDir);
    return entries
      .filter((n) => n.endsWith('.md'))
      .map((n) => n.replace(/\.md$/, ''))
      .sort();
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
}

async function readHistory(rel: string, version: string): Promise<string> {
  safePath(rel);
  if (!/^[\w\-:]+$/.test(version)) throw new Error(`invalid version: ${version}`);
  return fs.readFile(join(DOCS_ROOT, HISTORY_DIRNAME, rel, `${version}.md`), 'utf8');
}

async function generatePdf(rel: string): Promise<string> {
  const abs = safePath(rel);
  if (!abs.endsWith('.md')) throw new Error('path must point to a .md file');
  await fs.access(abs);
  await fs.mkdir(PDF_OUT_DIR, { recursive: true });
  await execFileAsync('bash', [BUILD_SH, abs], { cwd: REPO_ROOT });
  const baseName = abs.split('/').pop()!.replace(/\.md$/, '');
  const builtPdf = join(PDF_OUT_DIR, `${baseName}.pdf`);
  const targetPdf = abs.replace(/\.md$/, '.pdf');
  await fs.rename(builtPdf, targetPdf);
  return targetPdf;
}

// ETag = mtimeMs as string. Cheap, monotonic per file, no hashing needed.
function etagFromStat(s: Stats): string {
  return `"${Math.floor(s.mtimeMs)}"`;
}

async function statOrNull(abs: string): Promise<Stats | null> {
  try {
    return await fs.stat(abs);
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

// --- SSE broadcast channel ----------------------------------------------------
// Clients subscribe to /api/events and receive { type, path } messages on every
// filesystem change inside DOCS_ROOT. Powers live-reload + conflict detection.

type FsEvent = { type: 'doc-changed' | 'tree-changed'; path?: string };
const sseClients = new Set<Response>();

function broadcast(event: FsEvent): void {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of sseClients) res.write(payload);
}

// Debounce noisy fs.watch events (editors often emit 2-3 per save).
const debouncedPaths = new Map<string, NodeJS.Timeout>();
function notifyDocChanged(rel: string): void {
  const existing = debouncedPaths.get(rel);
  if (existing) clearTimeout(existing);
  debouncedPaths.set(
    rel,
    setTimeout(() => {
      debouncedPaths.delete(rel);
      broadcast({ type: 'doc-changed', path: rel });
    }, 80),
  );
}

// Recursive watch is supported on darwin + win32. Linux needs chokidar.
watch(DOCS_ROOT, { recursive: true }, (_eventType, filename) => {
  if (!filename) return;
  const rel = filename.toString();
  // Ignore history snapshots and hidden files.
  if (rel.startsWith(HISTORY_DIRNAME) || rel.split('/').some((seg) => seg.startsWith('.'))) return;
  if (rel.endsWith('.md')) notifyDocChanged(rel);
  else broadcast({ type: 'tree-changed' });
});

// --- HTTP routes --------------------------------------------------------------

app.use(cors({ origin: 'http://localhost:4200', exposedHeaders: ['ETag'] }));
app.use(express.json({ limit: '2mb' }));

app.get('/api/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();
  res.write(`: connected\n\n`);
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

app.get('/api/tree', async (req, res) => {
  try {
    const path = (req.query.path as string | undefined) ?? '';
    res.json(await listDocs(path));
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get('/api/doc', async (req, res) => {
  try {
    const path = req.query.path as string;
    const abs = safePath(path);
    const [text, stat] = await Promise.all([fs.readFile(abs, 'utf8'), fs.stat(abs)]);
    res.set('ETag', etagFromStat(stat));
    res.type('text/markdown').send(text);
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.put('/api/doc', async (req, res) => {
  try {
    const { path, content } = req.body as { path: string; content: string };
    if (!path || typeof content !== 'string') throw new Error('path and content required');
    const abs = safePath(path);
    const ifMatch = req.header('If-Match');

    // Optimistic locking: reject if file changed since the client last read it.
    if (ifMatch) {
      const current = await statOrNull(abs);
      const currentEtag = current ? etagFromStat(current) : null;
      if (currentEtag && currentEtag !== ifMatch) {
        res.status(409).set('ETag', currentEtag).json({
          error: 'Datei wurde extern geändert. Bitte neu laden.',
          currentEtag,
        });
        return;
      }
    }

    await snapshotIfExists(path);
    await fs.mkdir(dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, 'utf8');
    const newStat = await fs.stat(abs);
    const newEtag = etagFromStat(newStat);
    res.set('ETag', newEtag).json({ ok: true, etag: newEtag });
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/pdf', async (req, res) => {
  try {
    const { path } = req.body as { path: string };
    const pdfPath = await generatePdf(path);
    const buf = await fs.readFile(pdfPath);
    res.type('application/pdf').send(buf);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[pdf]', message);
    res.status(500).json({ error: message });
  }
});

app.get('/api/history', async (req, res) => {
  try {
    res.json(await listHistory(req.query.path as string));
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get('/api/history/version', async (req, res) => {
  try {
    const text = await readHistory(req.query.path as string, req.query.version as string);
    res.type('text/markdown').send(text);
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`pdf-builder server on http://localhost:${PORT}`);
  console.log(`DOCS_ROOT=${DOCS_ROOT}`);
});

