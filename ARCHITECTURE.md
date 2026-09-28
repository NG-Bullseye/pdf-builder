# ARCHITECTURE — pdf-builder

## Deep Modules — Markdown → PDF über einen gemeinsamen docs-Ordner

Flow: Markdown liegt unter `DOCS_ROOT`; Webapp (über den Express-Server) und MCP-Server lesen, schreiben und versionieren dort; gerendert wird immer über `build.sh` (pandoc → HTML mit Theme → WeasyPrint → PDF). Keine Flow-Datei; die Render-Sequenz lebt in `build.sh`. Jede Innenleben-Zelle ist datei:zeile und muss per grep -n treffen.

## Flow

**Sequenz**

| # | Modul | Eingang | Ausgang | Bedingung | Stellschraube | Innenleben |
|---|---|---|---|---|---|---|
| 1 | Pfad-Guard | relativer Pfad | absoluter Pfad in `DOCS_ROOT` | kein Traversal | `DOCS_ROOT` | server/src/index.ts:26 `startsWith(DOCS_ROOT` |
| 2 | Write + History | Markdown | Datei + Snapshot `.history/<path>/<ts>.md` | Datei existiert | — | server/src/index.ts:199 `app.put('/api/doc'` |
| 3 | pandoc | `.md` + Theme | HTML | Theme hat `style.css`, `template.html` | `PDF_THEME` | build.sh:56 `pandoc` |
| 4 | WeasyPrint | HTML | PDF | — | `--logo` | build.sh:65 `weasyprint` |

**Parallel**

| Modul | Eingang | Ausgang | Bedingung | Stellschraube | Innenleben |
|---|---|---|---|---|---|
| Server | REST (port 3001) | tree, doc, pdf, history, events | — | `PORT` | server/src/index.ts:10 `PORT = 3001` |
| Webapp | Browser (port 4200) | Editor, Vorschau | Server läuft | — | app/src/app/app.ts:183 `/pdf` |
| MCP | stdio | sieben Tools (`list_docs` … `explain`) | — | `DOCS_ROOT` | mcp/src/index.ts:135 `list_docs` |

## Schnittstellen

- REST unter `/api/*` (server/src/index.ts:178 `/api/tree`), SSE `/api/events`.
- Themes `themes/<name>/`; nur `default` und `example` getrackt (.gitignore:17 `themes/*`).

## Standard: Deep Modules + Flow

Standard R1–R5 steht in `~/repos/speech-engine/ARCHITECTURE.md`.
