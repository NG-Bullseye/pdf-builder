# pdf-builder

Markdown to PDF with a small editor webapp and an MCP server, sharing a single docs folder. Pandoc + WeasyPrint pipeline.

## What you get

- **CLI** — `build.sh some.md` renders a PDF using the active theme.
- **Server** (Express, port 3001) — REST API to list, read, write, version and render docs from `DOCS_ROOT`.
- **Webapp** (Angular + Ionic, port 4200) — sidebar tree, markdown editor, save, generate, PDF preview.
- **MCP server** — stdio JSON-RPC tools so an LLM can do the same things the webapp does.

All four operate on the same on-disk folder: edits via the webapp show up in the MCP and vice versa.

## Requirements

- Node.js 20+
- `pandoc`
- `weasyprint`

## Quick start

```bash
./start.sh
```

Then open http://localhost:4200. The default `DOCS_ROOT` is `./docs/` (auto-created on first write).

CLI alternative:

```bash
./build.sh path/to/file.md
```

PDF lands in `out/`.

## Configuration

| Env var | Default | Effect |
|---|---|---|
| `DOCS_ROOT` | `<repo>/docs` | Folder that holds the markdown sources, history snapshots, and rendered PDFs. |
| `PDF_THEME` | `default` | Theme directory under `themes/`. |

## Themes

A theme is a folder under `themes/` with two required files and one optional:

```
themes/<name>/
  style.css        # required — page layout, typography, colors
  template.html    # required — pandoc HTML wrapper
  logo.png         # optional — auto-used if present and no --logo flag
```

To brand it for your org:

1. `cp -r themes/default themes/myorg`
2. Edit `style.css` (brand color, fonts, footer text in `@bottom-center`).
3. Drop your `logo.png` into the folder.
4. `PDF_THEME=myorg ./build.sh some.md`

The `.gitignore` ships with `themes/*/` excluded except `themes/default/`, so a private branded theme stays out of the public repo automatically.

## MCP server

Build and register:

```bash
cd mcp && npm install && npm run build
claude mcp add pdf-builder --scope user -- node "$PWD/dist/index.js"
```

Tools exposed: `list_docs`, `read_doc`, `write_doc`, `list_history`, `read_history`, `generate_pdf`, `explain`. See `mcp/explain.md`.

Path traversal is blocked: tool args must be relative to `DOCS_ROOT`.

## Repo layout

```
build.sh             # CLI entry
start.sh             # boots server + webapp
themes/default/      # ships in the public repo
themes/<other>/      # gitignored — your private brand
docs/                # gitignored — your content
out/                 # gitignored — CLI build artefacts
server/              # Express REST API
app/                 # Angular + Ionic editor
mcp/                 # stdio MCP server
```

## Versioning

Every overwrite via `write_doc` or `PUT /api/doc` snapshots the previous file content into `<DOCS_ROOT>/.history/<path>/<ISO-timestamp>.md` before overwriting. Append-only, no deletes. Restore by reading a snapshot and writing it back.

## License

TBD.
