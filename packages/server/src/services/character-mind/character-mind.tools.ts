import { readFile, rename, rm } from "node:fs/promises";
import type { LLMToolCall, LLMToolDefinition } from "../llm/base-provider.js";
import {
  atomicWrite,
  listMarkdown,
  normalizeMindPath,
  pathExists,
  resolveMindMarkdown,
  verifyRawMarkdown,
} from "./character-mind.files.js";

type MindOperation = "ingest" | "query" | "lint";

export interface CharacterMindTrace {
  listed: string[];
  searched: string[];
  read: Set<string>;
  verifiedRaw: Set<string>;
  created: Set<string>;
  updated: Set<string>;
  moved: Set<string>;
  deleted: Set<string>;
}

export function createCharacterMindTrace(): CharacterMindTrace {
  return {
    listed: [],
    searched: [],
    read: new Set(),
    verifiedRaw: new Set(),
    created: new Set(),
    updated: new Set(),
    moved: new Set(),
    deleted: new Set(),
  };
}

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const ALL_TOOLS: LLMToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "mind_list_markdown",
      description: "List Markdown files in the selected Character Mind.",
      parameters: objectSchema({ path: { type: "string" } }),
    },
  },
  {
    type: "function",
    function: {
      name: "mind_search_markdown",
      description: "Search wiki or raw Markdown filenames and contents for literal text.",
      parameters: objectSchema(
        {
          query: { type: "string" },
          areas: { type: "array", items: { type: "string", enum: ["wiki", "raw"] }, minItems: 1 },
          limit: { type: "integer", minimum: 1, maximum: 50 },
        },
        ["query", "areas"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "mind_read_markdown",
      description: "Read one or more Markdown files or line ranges from the selected Character Mind.",
      parameters: objectSchema(
        {
          reads: {
            type: "array",
            minItems: 1,
            maxItems: 12,
            items: objectSchema(
              {
                path: { type: "string" },
                startLine: { type: "integer", minimum: 1 },
                maxLines: { type: "integer", minimum: 1, maximum: 2000 },
              },
              ["path"],
            ),
          },
        },
        ["reads"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "mind_write_wiki",
      description: "Create or replace Markdown pages below wiki/.",
      parameters: objectSchema(
        {
          files: {
            type: "array",
            minItems: 1,
            maxItems: 12,
            items: objectSchema({ path: { type: "string" }, content: { type: "string" } }, ["path", "content"]),
          },
        },
        ["files"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "mind_write_index",
      description: "Replace index.md after wiki maintenance.",
      parameters: objectSchema({ content: { type: "string" } }, ["content"]),
    },
  },
  {
    type: "function",
    function: {
      name: "mind_move_wiki",
      description: "Move or rename wiki pages during lint.",
      parameters: objectSchema(
        {
          moves: {
            type: "array",
            minItems: 1,
            maxItems: 12,
            items: objectSchema({ from: { type: "string" }, to: { type: "string" } }, ["from", "to"]),
          },
        },
        ["moves"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "mind_delete_wiki",
      description: "Delete unreferenced wiki pages during lint.",
      parameters: objectSchema({ paths: { type: "array", minItems: 1, maxItems: 12, items: { type: "string" } } }, [
        "paths",
      ]),
    },
  },
];

function parseArguments(call: LLMToolCall): Record<string, unknown> {
  try {
    const value = JSON.parse(call.function.arguments);
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  } catch {
    // Report a stable tool error to the model.
  }
  throw new Error(`Invalid arguments for ${call.function.name}`);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  return value;
}

function wikiPath(value: unknown): string {
  const path = normalizeMindPath(requireString(value, "path"));
  if (!/^wiki\/[^/]+\.md$/i.test(path)) throw new Error("Only flat wiki/*.md files are permitted");
  return path;
}

export function extractWikilinks(content: string): string[] {
  const links: string[] = [];
  for (const match of content.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)) {
    const target = match[1]?.trim();
    if (target) links.push(target.toLowerCase().endsWith(".md") ? target : `${target}.md`);
  }
  return links;
}

function wikilinkPath(sourcePath: string, link: string): string {
  const normalized = normalizeMindPath(link);
  if (normalized.includes("/")) return normalized;
  return sourcePath === "index.md" || sourcePath.startsWith("wiki/") ? `wiki/${normalized}` : normalized;
}

function hasRawSourceCitation(content: string): boolean {
  const sourceBody = /^##\s+Sources\s*$([\s\S]*)$/im.exec(content)?.[1] ?? "";
  return extractWikilinks(sourceBody).some((link) => link.startsWith("raw/"));
}

async function validateWikiContent(root: string, path: string, content: string): Promise<void> {
  if (Buffer.byteLength(content, "utf8") > 64 * 1024) throw new Error(`${path} exceeds 64 KiB`);
  const h1s = content.match(/^#\s+\S.+$/gm) ?? [];
  if (h1s.length !== 1) throw new Error(`${path} must contain exactly one H1`);
  const sourceSections = content.match(/^##\s+Sources\s*$/gim) ?? [];
  if (sourceSections.length !== 1) throw new Error(`${path} must contain exactly one ## Sources section`);
  if (!hasRawSourceCitation(content)) throw new Error(`${path} must cite at least one raw source under ## Sources`);
  for (const link of extractWikilinks(content)) {
    const normalized = wikilinkPath(path, link);
    const resolved = await resolveMindMarkdown(root, normalized);
    if (!(await pathExists(resolved.path)) && normalized !== path)
      throw new Error(`${path} has unresolved wikilink: ${link}`);
  }
}

export async function deterministicMindFindings(root: string): Promise<string[]> {
  const files = await listMarkdown(root);
  const known = new Set(files.map((path) => path.toLowerCase()));
  const findings: string[] = [];
  const inbound = new Map(files.filter((path) => path.startsWith("wiki/")).map((path) => [path.toLowerCase(), 0]));
  for (const path of files.filter((candidate) => candidate === "index.md" || candidate.startsWith("wiki/"))) {
    const { path: full } = await resolveMindMarkdown(root, path);
    const content = await readFile(full, "utf8");
    for (const link of extractWikilinks(content)) {
      const key = wikilinkPath(path, link).toLowerCase();
      if (!known.has(key)) findings.push(`Broken link in ${path}: [[${link.replace(/\.md$/i, "")}]]`);
      if (inbound.has(key)) inbound.set(key, (inbound.get(key) ?? 0) + 1);
    }
  }
  for (const [path, count] of inbound) if (count === 0) findings.push(`Orphan wiki page: ${path}`);
  return [...new Set(findings)].sort();
}

export function createCharacterMindTools(root: string, operation: MindOperation, trace: CharacterMindTrace) {
  const writable = operation !== "query";
  const toolNames = new Set([
    "mind_list_markdown",
    "mind_search_markdown",
    "mind_read_markdown",
    ...(writable ? ["mind_write_wiki", "mind_write_index"] : []),
    ...(operation === "lint" ? ["mind_move_wiki", "mind_delete_wiki"] : []),
  ]);
  const tools = ALL_TOOLS.filter((tool) => toolNames.has(tool.function.name));

  async function execute(call: LLMToolCall): Promise<string> {
    if (!toolNames.has(call.function.name))
      throw new Error(
        `Tool "${call.function.name}" is not permitted during ${operation}. Use only these exact tool names: ${[
          ...toolNames,
        ].join(", ")}`,
      );
    const args = parseArguments(call);

    if (call.function.name === "mind_list_markdown") {
      const relativeDir = typeof args.path === "string" ? args.path.replaceAll("\\", "/").replace(/^\.\//, "") : "";
      trace.listed.push(relativeDir);
      return JSON.stringify({ files: await listMarkdown(root, relativeDir) });
    }

    if (call.function.name === "mind_search_markdown") {
      const query = requireString(args.query, "query").trim().toLowerCase();
      if (!query) throw new Error("query must not be empty");
      const areas = Array.isArray(args.areas) ? args.areas.filter((area) => area === "wiki" || area === "raw") : [];
      if (areas.length === 0) throw new Error("areas must include wiki or raw");
      const limit = Math.max(1, Math.min(50, Number(args.limit) || 20));
      const files = (await listMarkdown(root)).filter((path) => areas.some((area) => path.startsWith(`${area}/`)));
      const matches: Array<{ path: string; snippet: string }> = [];
      for (const path of files) {
        const resolved = await resolveMindMarkdown(root, path);
        if (path.startsWith("raw/")) await verifyRawMarkdown(root, path);
        const content = await readFile(resolved.path, "utf8");
        const haystack = `${path}\n${content}`.toLowerCase();
        const index = haystack.indexOf(query);
        if (index < 0) continue;
        trace.read.add(path);
        if (path.startsWith("raw/")) trace.verifiedRaw.add(path);
        const contentIndex = Math.max(0, index - path.length - 1);
        matches.push({ path, snippet: content.slice(Math.max(0, contentIndex - 100), contentIndex + 300) });
        if (matches.length >= limit) break;
      }
      trace.searched.push(query);
      return JSON.stringify({ matches });
    }

    if (call.function.name === "mind_read_markdown") {
      if (!Array.isArray(args.reads) || args.reads.length < 1 || args.reads.length > 12)
        throw new Error("reads must contain 1 to 12 files");
      let bytes = 0;
      const reads = [];
      for (const item of args.reads as Array<Record<string, unknown>>) {
        const relativePath = normalizeMindPath(requireString(item.path, "path"));
        const resolved = await resolveMindMarkdown(root, relativePath);
        if (relativePath.startsWith("raw/")) {
          await verifyRawMarkdown(root, relativePath);
          trace.verifiedRaw.add(relativePath);
        }
        const content = await readFile(resolved.path, "utf8");
        const lines = content.split(/\r?\n/);
        const startLine = Math.max(1, Number(item.startLine) || 1);
        const maxLines = Math.max(1, Math.min(2000, Number(item.maxLines) || 2000));
        const excerpt = lines.slice(startLine - 1, startLine - 1 + maxLines).join("\n");
        bytes += Buffer.byteLength(excerpt, "utf8");
        if (bytes > 256 * 1024) throw new Error("Combined read exceeds 256 KiB");
        trace.read.add(relativePath);
        reads.push({
          path: relativePath,
          startLine,
          endLine: Math.min(lines.length, startLine + maxLines - 1),
          content: excerpt,
        });
      }
      return JSON.stringify({ reads });
    }

    if (call.function.name === "mind_write_wiki") {
      if (!Array.isArray(args.files) || args.files.length < 1 || args.files.length > 12)
        throw new Error("files must contain 1 to 12 pages");
      const staged: Array<{ relativePath: string; fullPath: string; content: string; existed: boolean }> = [];
      for (const item of args.files as Array<Record<string, unknown>>) {
        const relativePath = wikiPath(item.path);
        const content = requireString(item.content, "content");
        const resolved = await resolveMindMarkdown(root, relativePath);
        staged.push({ relativePath, fullPath: resolved.path, content, existed: await pathExists(resolved.path) });
      }
      // Validate structure first; unresolved links to another page in this batch are allowed.
      const batchPaths = new Set(staged.map((file) => file.relativePath.toLowerCase()));
      for (const file of staged) {
        if (Buffer.byteLength(file.content, "utf8") > 64 * 1024) throw new Error(`${file.relativePath} exceeds 64 KiB`);
        if ((file.content.match(/^#\s+\S.+$/gm) ?? []).length !== 1)
          throw new Error(`${file.relativePath} must contain exactly one H1`);
        if ((file.content.match(/^##\s+Sources\s*$/gim) ?? []).length !== 1)
          throw new Error(`${file.relativePath} must contain exactly one ## Sources section`);
        if (!hasRawSourceCitation(file.content))
          throw new Error(`${file.relativePath} must cite at least one raw source under ## Sources`);
        for (const link of extractWikilinks(file.content)) {
          const normalized = wikilinkPath(file.relativePath, link);
          if (normalized.startsWith("raw/") && !trace.verifiedRaw.has(normalized)) {
            throw new Error(`${file.relativePath} cites a raw source that was not read: ${normalized}`);
          }
          const target = await resolveMindMarkdown(root, normalized);
          if (!(await pathExists(target.path)) && !batchPaths.has(normalized.toLowerCase()))
            throw new Error(`${file.relativePath} has unresolved wikilink: ${link}`);
        }
      }
      for (const file of staged) {
        await atomicWrite(file.fullPath, file.content);
        (file.existed ? trace.updated : trace.created).add(file.relativePath);
      }
      return JSON.stringify({ written: staged.map((file) => file.relativePath) });
    }

    if (call.function.name === "mind_write_index") {
      const content = requireString(args.content, "content");
      if (Buffer.byteLength(content, "utf8") > 128 * 1024) throw new Error("index.md exceeds 128 KiB");
      for (const link of extractWikilinks(content)) {
        const normalized = wikilinkPath("index.md", link);
        if (!normalized.startsWith("wiki/")) throw new Error("index.md may only link to wiki pages");
        const target = await resolveMindMarkdown(root, normalized);
        if (!(await pathExists(target.path))) throw new Error(`index.md has unresolved wikilink: ${link}`);
      }
      await atomicWrite((await resolveMindMarkdown(root, "index.md")).path, content);
      trace.updated.add("index.md");
      return JSON.stringify({ written: "index.md" });
    }

    if (call.function.name === "mind_move_wiki") {
      if (!Array.isArray(args.moves) || args.moves.length < 1 || args.moves.length > 12)
        throw new Error("moves must contain 1 to 12 pages");
      const moves = [];
      for (const item of args.moves as Array<Record<string, unknown>>) {
        const from = wikiPath(item.from);
        const to = wikiPath(item.to);
        const source = await resolveMindMarkdown(root, from);
        const target = await resolveMindMarkdown(root, to);
        if (!(await pathExists(source.path))) throw new Error(`Missing source page: ${from}`);
        if (await pathExists(target.path)) throw new Error(`Target already exists: ${to}`);
        moves.push({ from, to, source: source.path, target: target.path });
      }
      for (const move of moves) {
        await rename(move.source, move.target);
        trace.moved.add(`${move.from} -> ${move.to}`);
      }
      return JSON.stringify({ moved: moves.map(({ from, to }) => ({ from, to })) });
    }

    if (call.function.name === "mind_delete_wiki") {
      if (!Array.isArray(args.paths) || args.paths.length < 1 || args.paths.length > 12)
        throw new Error("paths must contain 1 to 12 pages");
      const paths = args.paths.map(wikiPath);
      const deleting = new Set(paths.map((path) => path.toLowerCase()));
      for (const candidate of (await listMarkdown(root)).filter(
        (path) => path === "index.md" || path.startsWith("wiki/"),
      )) {
        if (deleting.has(candidate.toLowerCase())) continue;
        const content = await readFile((await resolveMindMarkdown(root, candidate)).path, "utf8");
        for (const link of extractWikilinks(content)) {
          if (deleting.has(wikilinkPath(candidate, link).toLowerCase()))
            throw new Error(`${candidate} still links to ${link}`);
        }
      }
      for (const path of paths) {
        await rm((await resolveMindMarkdown(root, path)).path);
        trace.deleted.add(path);
      }
      return JSON.stringify({ deleted: paths });
    }

    throw new Error(`Unknown Character Mind tool: ${call.function.name}`);
  }

  return { tools, execute };
}

export async function validateCompleteWiki(root: string): Promise<void> {
  const wikiPages = (await listMarkdown(root, "wiki")).filter((candidate) => candidate.startsWith("wiki/"));
  for (const path of wikiPages) {
    const resolved = await resolveMindMarkdown(root, path);
    await validateWikiContent(root, path, await readFile(resolved.path, "utf8"));
  }
  const index = await readFile((await resolveMindMarkdown(root, "index.md")).path, "utf8");
  const indexedPages = new Set<string>();
  for (const link of extractWikilinks(index)) {
    const normalized = wikilinkPath("index.md", link);
    const target = await resolveMindMarkdown(root, normalized);
    if (!(await pathExists(target.path))) throw new Error(`index.md has unresolved wikilink: ${link}`);
    if (normalized.startsWith("wiki/")) indexedPages.add(normalized.toLowerCase());
  }
  const missing = wikiPages.filter((path) => !indexedPages.has(path.toLowerCase()));
  if (missing.length) throw new Error(`index.md does not catalog: ${missing.join(", ")}`);
}
