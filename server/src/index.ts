import express from 'express';
import cors from 'cors';
import { exec } from 'child_process';
import { writeFileSync, unlinkSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { promisify } from 'util';

const execAsync = promisify(exec);
const app = express();
const PORT = 3001;

// Paths to shared assets (sibling to server/)
const ROOT = join(__dirname, '..', '..');
const CSS = join(ROOT, 'style.css');
const TEMPLATE = join(ROOT, 'template.html');

app.use(cors({ origin: 'http://localhost:4200' }));
app.use(express.json({ limit: '2mb' }));

app.post('/generate', async (req, res) => {
  const { markdown, logoPath } = req.body as { markdown: string; logoPath?: string };

  if (!markdown) {
    res.status(400).json({ error: 'markdown required' });
    return;
  }

  const ts = Date.now();
  const mdFile = join(tmpdir(), `pdf-builder-${ts}.md`);
  const htmlFile = join(tmpdir(), `pdf-builder-${ts}.html`);
  const pdfFile = join(tmpdir(), `pdf-builder-${ts}.pdf`);

  try {
    writeFileSync(mdFile, markdown, 'utf8');

    // Build logo HTML snippet
    const logoHtml = logoPath
      ? `<div id="page-logo"><img src="file://${logoPath}" alt="Logo"></div>`
      : '';

    await execAsync(
      `pandoc "${mdFile}" --from gfm --to html5 --standalone ` +
      `--css "${CSS}" --template "${TEMPLATE}" ` +
      `--variable logo_html="${logoHtml.replace(/"/g, '\\"')}" ` +
      `-o "${htmlFile}"`
    );

    await execAsync(`weasyprint "${htmlFile}" "${pdfFile}"`);

    const pdf = readFileSync(pdfFile);
    res.set('Content-Type', 'application/pdf');
    res.send(pdf);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[generate]', message);
    res.status(500).json({ error: message });
  } finally {
    [mdFile, htmlFile, pdfFile].forEach(f => { try { unlinkSync(f); } catch {} });
  }
});

app.listen(PORT, () => console.log(`pdf-builder server on http://localhost:${PORT}`));
