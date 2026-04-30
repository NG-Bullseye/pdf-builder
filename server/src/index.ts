import express from 'express';
import cors from 'cors';
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
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

app.use(cors({ origin: 'http://localhost:4200' }));
app.use(express.json({ limit: '2mb' }));

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
    const text = await fs.readFile(safePath(path), 'utf8');
    res.type('text/markdown').send(text);
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.put('/api/doc', async (req, res) => {
  try {
    const { path, content } = req.body as { path: string; content: string };
    if (!path || typeof content !== 'string') throw new Error('path and content required');
    await snapshotIfExists(path);
    const abs = safePath(path);
    await fs.mkdir(dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, 'utf8');
    res.json({ ok: true });
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
