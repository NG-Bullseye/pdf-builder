# pdf-builder MCP — Quick Reference for the LLM

## What this is
An stdio MCP server that lets you read, write, and version markdown docs in
the user's GDrive `OneXip` folder, and render any of them to PDF using the
onexip-branded pandoc + weasyprint pipeline of this repo (`build.sh`).

## DOCS_ROOT
All `path` arguments in tools are RELATIVE to `DOCS_ROOT`.
Default: `<repo>/docs`. Override with env var `DOCS_ROOT` (absolute path).

Never pass absolute host paths. `..` is rejected.

## Tools

- `list_docs(path?)` — JSON tree of folders and `.md` files. Hidden entries
  (`.history`, dotfiles) are filtered out.
- `read_doc(path)` — returns the markdown content of a file.
- `write_doc(path, content)` — writes content. Before overwriting an existing
  file, snapshots the previous version to `<DOCS_ROOT>/.history/<path>/<ISO>.md`.
  Creates parent folders automatically.
- `list_history(path)` — lists ISO timestamps of all snapshots for a file.
- `read_history(path, version)` — returns the content of one snapshot.
- `generate_pdf(path)` — renders the markdown file to a PDF NEXT TO the source
  (same folder, same basename, `.pdf` extension). Uses the onexip logo and
  branding from the pdf-builder repo.
- `explain()` — returns this document.

## How PDF rendering works
1. `build.sh` in the repo root runs pandoc with `template.html` and
   `style.css`, producing HTML in `/tmp`.
2. weasyprint converts that HTML to PDF.
3. Output normally lands in `pdf-builder/out/`. The MCP overrides this and
   moves the result to sit next to the source MD inside DOCS_ROOT.

## Themes / Branding
Branding lives in `<repo>/themes/<name>/`. The active theme is selected via
the `PDF_THEME` env var (default: `default`). Each theme directory contains:

- `style.css` — typography, colors, page-break rules, header/footer running
  elements. Edit this to change brand color, fonts, layout.
- `template.html` — pandoc HTML wrapper. Edit to change document structure.
- `logo.{png,svg,jpg}` (optional) — auto-picked up by `build.sh` if present
  and no explicit `--logo` flag is passed.

To create a new theme: copy `themes/default/` to `themes/<your-name>/`, edit,
then run with `PDF_THEME=<your-name>`. Branded themes are gitignored;
the public repo ships only `themes/default/` and `themes/example/`.

After any edit to `style.css` or `template.html`, just call `generate_pdf`
again. No rebuild step.

## History / Versioning
Snapshots are append-only Markdown files with ISO timestamps as names. To
restore an older version:
1. `read_history(path, version)` to get the old content
2. `write_doc(path, oldContent)` — this also snapshots the current state
   before overwriting, so you never lose anything.

## Common errors
- `Path outside DOCS_ROOT` — you passed a path with `..` or an absolute path.
  Use only paths relative to DOCS_ROOT.
- `ENOENT` on read — file does not exist. Use `list_docs` first if unsure.
- `pandoc: command not found` / `weasyprint: command not found` — system
  dependencies missing on the user's machine; not something you can fix
  from inside the MCP.

## Conventions
- File names: kebab-case, descriptive, e.g. `vitacer-shopify-metafields.md`.
- Folder names: PascalCase or kebab-case, group by client or topic.
- Each consumer doc starts with a `# Title` and a short subtitle line.
