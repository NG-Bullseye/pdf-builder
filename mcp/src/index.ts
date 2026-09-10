#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { promises as fs } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const REPO_ROOT = resolve(__dirname, "..", "..");
const DOCS_ROOT = resolve(process.env.DOCS_ROOT ?? join(REPO_ROOT, "docs"));
const BUILD_SH = join(REPO_ROOT, "build.sh");
const PDF_OUT_DIR = join(REPO_ROOT, "out");
const EXPLAIN_MD = resolve(__dirname, "..", "explain.md");
const HISTORY_DIRNAME = ".history";

// Resolve a relative path inside DOCS_ROOT and reject anything that escapes.
function safePath(rel: string): string {
  if (typeof rel !== "string") throw new Error("path must be a string");
  const abs = resolve(DOCS_ROOT, rel);
  if (abs !== DOCS_ROOT && !abs.startsWith(DOCS_ROOT + "/")) {
    throw new Error(`Path outside DOCS_ROOT: ${rel}`);
  }
  return abs;
}

type TreeNode = {
  name: string;
  type: "dir" | "file";
  path: string;
  children?: TreeNode[];
};

async function listDocs(rel: string = ""): Promise<TreeNode[]> {
  const abs = safePath(rel);
  const entries = await fs.readdir(abs, { withFileTypes: true });
  const visible = entries.filter(
    (e) =>
      !e.name.startsWith(".") &&
      e.name !== HISTORY_DIRNAME &&
      (e.isDirectory() || e.name.endsWith(".md")),
  );
  return Promise.all(
    visible.map(async (e) => {
      const childRel = rel ? join(rel, e.name) : e.name;
      const node: TreeNode = {
        name: e.name,
        type: e.isDirectory() ? "dir" : "file",
        path: childRel,
      };
      if (e.isDirectory()) {
        node.children = await listDocs(childRel);
      }
      return node;
    }),
  );
}

async function snapshotIfExists(rel: string): Promise<void> {
  const abs = safePath(rel);
  let current: string;
  try {
    current = await fs.readFile(abs, "utf8");
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw e;
  }
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const histDir = join(DOCS_ROOT, HISTORY_DIRNAME, rel);
  await fs.mkdir(histDir, { recursive: true });
  await fs.writeFile(join(histDir, `${ts}.md`), current, "utf8");
}

async function listHistory(rel: string): Promise<string[]> {
  // Validate the doc path itself first.
  safePath(rel);
  const histDir = join(DOCS_ROOT, HISTORY_DIRNAME, rel);
  try {
    const entries = await fs.readdir(histDir);
    return entries
      .filter((n) => n.endsWith(".md"))
      .map((n) => n.replace(/\.md$/, ""))
      .sort();
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}

async function readHistory(rel: string, version: string): Promise<string> {
  safePath(rel);
  if (!/^[\w\-:]+$/.test(version)) {
    throw new Error(`invalid version: ${version}`);
  }
  const file = join(DOCS_ROOT, HISTORY_DIRNAME, rel, `${version}.md`);
  return fs.readFile(file, "utf8");
}

async function generatePdf(rel: string): Promise<string> {
  const abs = safePath(rel);
  if (!abs.endsWith(".md")) throw new Error("path must point to a .md file");
  await fs.access(abs);
  await fs.mkdir(PDF_OUT_DIR, { recursive: true });

  const { stdout, stderr } = await execFileAsync("bash", [BUILD_SH, abs], {
    cwd: REPO_ROOT,
  });

  // build.sh writes to pdf-builder/out/<basename>.pdf — move next to source.
  const baseName = abs.split("/").pop()!.replace(/\.md$/, "");
  const builtPdf = join(PDF_OUT_DIR, `${baseName}.pdf`);
  const targetPdf = abs.replace(/\.md$/, ".pdf");
  await fs.rename(builtPdf, targetPdf);

  return `wrote ${targetPdf}\n${stdout}${stderr ? `\nstderr:\n${stderr}` : ""}`;
}

const server = new Server(
  { name: "pdf-builder", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "list_docs",
      description:
        "Lists markdown docs and folders inside DOCS_ROOT as a JSON tree. " +
        "Hidden entries and the .history folder are filtered out.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Optional sub-folder relative to DOCS_ROOT. Defaults to root.",
          },
        },
      },
    },
    {
      name: "read_doc",
      description: "Reads a markdown file inside DOCS_ROOT.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path inside DOCS_ROOT." },
        },
        required: ["path"],
      },
    },
    {
      name: "write_doc",
      description:
        "Writes markdown to a path inside DOCS_ROOT. Snapshots the previous " +
        "version (if any) into <DOCS_ROOT>/.history/<path>/<ISO>.md before " +
        "overwriting. Creates parent folders automatically.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
    },
    {
      name: "list_history",
      description:
        "Lists ISO timestamps of all snapshots for a given doc path. " +
        "Returns an empty array if the file has no history yet.",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
    {
      name: "read_history",
      description: "Returns the content of one historical snapshot of a doc.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          version: {
            type: "string",
            description:
              "ISO timestamp string returned by list_history (no .md suffix).",
          },
        },
        required: ["path", "version"],
      },
    },
    {
      name: "generate_pdf",
      description:
        "Renders a markdown file to PDF and writes it next to the source MD " +
        "(same folder, same basename, .pdf extension) inside DOCS_ROOT. Uses " +
        "the onexip-branded pandoc + weasyprint pipeline of the pdf-builder repo (build.sh). " +
        "Call explain() first to learn how to change branding/layout.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Relative path to the .md file inside DOCS_ROOT.",
          },
        },
        required: ["path"],
      },
    },
    {
      name: "explain",
      description:
        "Returns a textual guide describing how this MCP works, where DOCS_ROOT " +
        "is, how PDF rendering works, and how to change branding (colors, footer, " +
        "logo, page breaks). Read this once per session before making changes.",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: rawArgs } = req.params;
  const args = (rawArgs ?? {}) as Record<string, unknown>;

  try {
    switch (name) {
      case "list_docs": {
        const path = (args.path as string | undefined) ?? "";
        const tree = await listDocs(path);
        return { content: [{ type: "text", text: JSON.stringify(tree, null, 2) }] };
      }
      case "read_doc": {
        const text = await fs.readFile(safePath(args.path as string), "utf8");
        return { content: [{ type: "text", text }] };
      }
      case "write_doc": {
        const path = args.path as string;
        const content = args.content as string;
        await snapshotIfExists(path);
        const abs = safePath(path);
        await fs.mkdir(dirname(abs), { recursive: true });
        await fs.writeFile(abs, content, "utf8");
        return { content: [{ type: "text", text: `wrote ${path}` }] };
      }
      case "list_history": {
        const versions = await listHistory(args.path as string);
        return { content: [{ type: "text", text: JSON.stringify(versions, null, 2) }] };
      }
      case "read_history": {
        const text = await readHistory(args.path as string, args.version as string);
        return { content: [{ type: "text", text }] };
      }
      case "generate_pdf": {
        const out = await generatePdf(args.path as string);
        return { content: [{ type: "text", text: out }] };
      }
      case "explain": {
        const text = await fs.readFile(EXPLAIN_MD, "utf8");
        return { content: [{ type: "text", text }] };
      }
      default:
        throw new Error(`unknown tool: ${name}`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: "text", text: message }],
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
// All logs to stderr; stdout is reserved for the JSON-RPC protocol.
console.error(
  `[pdf-builder-mcp] connected. DOCS_ROOT=${DOCS_ROOT} REPO_ROOT=${REPO_ROOT}`,
);
