import { readFile } from "node:fs/promises";
import type { LLMToolCall, LLMToolDefinition } from "../llm/base-provider.js";
import {
  listMarkdown,
  normalizeMindPath,
  pathExists,
  resolveMindMarkdown,
  verifyRawMarkdown,
} from "./character-mind.files.js";
import type { CharacterMindCandidateSet } from "./character-mind.candidate.js";

type MindOperation = "plan" | "build-page" | "ingest" | "query" | "lint" | "edit" | "write-page" | "write-index";

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
      description: "Read one Markdown file with path, or batch-read files with reads.",
      parameters: objectSchema({
        path: { type: "string" },
        startLine: { type: "integer", minimum: 1 },
        maxLines: { type: "integer", minimum: 1, maximum: 2000 },
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
      }),
    },
  },
  {
    type: "function",
    function: {
      name: "mind_edit_candidate",
      description:
        "Apply one bounded exact replacement to an existing temporary page candidate. oldText must match exactly once.",
      parameters: objectSchema(
        {
          path: { type: "string" },
          oldText: { type: "string", minLength: 1, maxLength: 16384 },
          newText: { type: "string", maxLength: 16384 },
        },
        ["path", "oldText", "newText"],
      ),
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

export function extractWikilinks(content: string): string[] {
  const links: string[] = [];
  for (const match of content.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)) {
    const target = match[1]?.trim();
    if (target) links.push(target.toLowerCase().endsWith(".md") ? target : `${target}.md`);
  }
  return links;
}

export function wikilinkPath(sourcePath: string, link: string): string {
  const normalized = normalizeMindPath(link);
  if (normalized.includes("/")) return normalized;
  return sourcePath === "index.md" || sourcePath.startsWith("wiki/") ? `wiki/${normalized}` : normalized;
}

function rawSourceCitations(content: string): string[] {
  const sourceBody = /^##\s+Sources\s*$([\s\S]*)$/im.exec(content)?.[1] ?? "";
  return extractWikilinks(sourceBody).filter((link) => link.startsWith("raw/"));
}

export async function validateWikiPageCandidate(
  root: string,
  path: string,
  content: string,
  options: {
    knownPaths?: ReadonlySet<string>;
    requiredSources?: ReadonlySet<string>;
    verifiedRaw?: ReadonlySet<string>;
  } = {},
): Promise<void> {
  if (Buffer.byteLength(content, "utf8") > 64 * 1024) throw new Error(`${path} exceeds 64 KiB`);
  const h1s = content.match(/^#\s+\S.+$/gm) ?? [];
  if (h1s.length !== 1) throw new Error(`${path} must contain exactly one H1`);
  const sourceSections = content.match(/^##\s+Sources\s*$/gim) ?? [];
  if (sourceSections.length !== 1) throw new Error(`${path} must contain exactly one ## Sources section`);
  const citedRaw = new Set(rawSourceCitations(content).map((source) => normalizeMindPath(source)));
  if (citedRaw.size === 0) throw new Error(`${path} must cite at least one raw source under ## Sources`);
  if (options.requiredSources) {
    const missing = [...options.requiredSources].filter((source) => !citedRaw.has(source));
    const unexpected = [...citedRaw].filter((source) => !options.requiredSources!.has(source));
    if (missing.length) throw new Error(`${path} does not cite assigned sources: ${missing.join(", ")}`);
    if (unexpected.length) throw new Error(`${path} cites sources outside its map: ${unexpected.join(", ")}`);
  }
  for (const link of extractWikilinks(content)) {
    const normalized = wikilinkPath(path, link);
    if (normalized.startsWith("raw/")) {
      await verifyRawMarkdown(root, normalized);
      if (options.verifiedRaw && !options.verifiedRaw.has(normalized))
        throw new Error(`${path} cites a raw source that was not read: ${normalized}`);
      continue;
    }
    if (options.knownPaths?.has(normalized.toLowerCase()) || normalized === path) continue;
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

export function createCharacterMindTools(
  root: string,
  operation: MindOperation,
  trace: CharacterMindTrace,
  options: {
    candidate?: CharacterMindCandidateSet;
    editablePaths?: string[];
  } = {},
) {
  const editablePaths = new Set((options.editablePaths ?? []).map((path) => normalizeMindPath(path).toLowerCase()));
  const toolNames = new Set([
    "mind_list_markdown",
    "mind_search_markdown",
    "mind_read_markdown",
    ...(operation === "edit" ? ["mind_edit_candidate"] : []),
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
      const requestedReads = typeof args.path === "string" ? [args] : args.reads;
      if (!Array.isArray(requestedReads) || requestedReads.length < 1 || requestedReads.length > 12)
        throw new Error("reads must contain 1 to 12 files");
      let bytes = 0;
      const reads = [];
      for (const item of requestedReads as Array<Record<string, unknown>>) {
        const relativePath = normalizeMindPath(requireString(item.path, "path"));
        const resolved = await resolveMindMarkdown(root, relativePath);
        if (relativePath.startsWith("raw/")) {
          await verifyRawMarkdown(root, relativePath);
          trace.verifiedRaw.add(relativePath);
        }
        const content =
          options.candidate && editablePaths.has(relativePath.toLowerCase())
            ? await options.candidate.read(relativePath)
            : await readFile(resolved.path, "utf8");
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

    if (call.function.name === "mind_edit_candidate") {
      if (!options.candidate) throw new Error("No Character Mind candidate is bound to this edit session");
      const relativePath = normalizeMindPath(requireString(args.path, "path"));
      if (!editablePaths.has(relativePath.toLowerCase())) throw new Error(`This session may not edit: ${relativePath}`);
      await options.candidate.edit(
        relativePath,
        requireString(args.oldText, "oldText"),
        requireString(args.newText, "newText"),
      );
      trace.updated.add(relativePath);
      return JSON.stringify({ edited: relativePath });
    }

    throw new Error(`Unknown Character Mind tool: ${call.function.name}`);
  }

  return { tools, execute };
}

export async function validateCompleteWiki(root: string, candidate?: CharacterMindCandidateSet): Promise<void> {
  const livePages = (await listMarkdown(root, "wiki")).filter((path) => path.startsWith("wiki/"));
  const wikiPages = [
    ...new Set([
      ...livePages.filter((path) => !candidate?.deleted.has(path)),
      ...(candidate?.candidatePaths().filter((path) => path.startsWith("wiki/")) ?? []),
    ]),
  ].sort();
  const knownPaths = new Set(wikiPages.map((path) => path.toLowerCase()));
  const candidatePaths = new Set(candidate?.candidatePaths() ?? []);
  for (const path of wikiPages) {
    const content =
      candidate && candidatePaths.has(path)
        ? await candidate.read(path)
        : await readFile((await resolveMindMarkdown(root, path)).path, "utf8");
    await validateWikiPageCandidate(root, path, content, { knownPaths });
  }
  const index =
    candidate && candidatePaths.has("index.md")
      ? await candidate.read("index.md")
      : await readFile((await resolveMindMarkdown(root, "index.md")).path, "utf8");
  if (Buffer.byteLength(index, "utf8") > 128 * 1024) throw new Error("index.md exceeds 128 KiB");
  const indexedPages = new Set<string>();
  for (const link of extractWikilinks(index)) {
    const normalized = wikilinkPath("index.md", link);
    if (normalized.startsWith("raw/")) {
      await verifyRawMarkdown(root, normalized);
      continue;
    }
    if (!normalized.startsWith("wiki/") || !knownPaths.has(normalized.toLowerCase()))
      throw new Error(`index.md has unresolved wikilink: ${link}`);
    indexedPages.add(normalized.toLowerCase());
  }
  const missing = wikiPages.filter((path) => !indexedPages.has(path.toLowerCase()));
  if (missing.length) throw new Error(`index.md does not catalog: ${missing.join(", ")}`);
}
