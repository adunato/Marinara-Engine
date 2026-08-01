import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { CharacterData, DailyMemory } from "@marinara-engine/shared";
import { getDataDir } from "../../utils/data-dir.js";
import {
  CHARACTER_MIND_DIR,
  CHARACTER_MIND_INDEX,
  CHARACTER_MIND_LOG,
  CHARACTER_MIND_RAW_MAX_BYTES,
  CHARACTER_MIND_SCHEMA,
} from "./character-mind.constants.js";

export interface CharacterCardRawPayload {
  characterId: string;
  chatId: string;
  data: CharacterData;
  conversationOverrides: { aboutMe: string | null };
}

export interface DailyMemoryRawPayload {
  chatId: string;
  date: string;
  memories: Array<Pick<DailyMemory, "id" | "memory" | "importance" | "createdAt" | "updatedAt">>;
}

export interface AutoSummaryRawPayload {
  chatId: string;
  period: "day" | "week";
  date: string;
  summary: string;
  keyDetails: string[];
}

type RawSourceType = "character-card" | "auto-summary" | "daily-memories";
type RawArea = "character-card" | "auto-summaries/day" | "auto-summaries/week" | "daily-memories";

export interface RawSnapshot {
  path: string;
  revision: string;
  created: boolean;
  sourceKey: string;
}

export function stableJson(value: unknown): string {
  const normalize = (candidate: unknown): unknown => {
    if (Array.isArray(candidate)) return candidate.map(normalize);
    if (candidate && typeof candidate === "object") {
      return Object.fromEntries(
        Object.entries(candidate as Record<string, unknown>)
          .filter(([, item]) => item !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, normalize(item)]),
      );
    }
    return candidate;
  };
  return JSON.stringify(normalize(value));
}

function prettyStableJson(value: unknown): string {
  return JSON.stringify(JSON.parse(stableJson(value)), null, 2);
}

export function revisionForPayload(value: unknown): string {
  return createHash("sha256").update(stableJson(value), "utf8").digest("hex").slice(0, 16);
}

function safeSegment(value: string): string {
  if (!value || value === "." || value === ".." || /[\\/\0]/.test(value))
    throw new Error("Invalid Character Mind identifier");
  return value;
}

export function characterMindsRoot(): string {
  return join(getDataDir(), CHARACTER_MIND_DIR);
}

export function mindRoot(chatId: string, characterId: string): string {
  return join(characterMindsRoot(), safeSegment(chatId), safeSegment(characterId));
}

export function normalizeMindPath(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "");
  if (
    !normalized ||
    isAbsolute(normalized) ||
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error("Invalid Character Mind path");
  }
  if (!normalized.toLowerCase().endsWith(".md")) throw new Error("Character Mind tools only support Markdown files");
  return normalized;
}

async function rejectSymlinks(root: string, target: string): Promise<void> {
  try {
    if ((await lstat(root)).isSymbolicLink()) throw new Error("Character Mind paths cannot traverse symlinks");
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }
  const rel = relative(root, target);
  let cursor = root;
  for (const part of rel.split(sep).filter(Boolean)) {
    cursor = join(cursor, part);
    try {
      if ((await lstat(cursor)).isSymbolicLink()) throw new Error("Character Mind paths cannot traverse symlinks");
    } catch (error: any) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
  }
}

export async function resolveMindMarkdown(
  root: string,
  relativePath: string,
): Promise<{ path: string; relativePath: string }> {
  const normalized = normalizeMindPath(relativePath);
  const target = resolve(root, ...normalized.split("/"));
  const rel = relative(resolve(root), target);
  if (rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) throw new Error("Path escapes the Character Mind");
  await rejectSymlinks(root, target);
  return { path: target, relativePath: normalized };
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, path);
}

async function createOnly(path: string, content: string): Promise<boolean> {
  await mkdir(dirname(path), { recursive: true });
  try {
    const handle = await open(path, "wx");
    try {
      await handle.writeFile(content, "utf8");
    } finally {
      await handle.close();
    }
    return true;
  } catch (error: any) {
    if (error?.code === "EEXIST") return false;
    throw error;
  }
}

export async function initializeMind(root: string): Promise<void> {
  await mkdir(join(root, "raw", "character-card"), { recursive: true });
  await mkdir(join(root, "raw", "auto-summaries", "day"), { recursive: true });
  await mkdir(join(root, "raw", "auto-summaries", "week"), { recursive: true });
  await mkdir(join(root, "raw", "daily-memories"), { recursive: true });
  await mkdir(join(root, "wiki"), { recursive: true });
  await createOnly(join(root, "SCHEMA.md"), CHARACTER_MIND_SCHEMA);
  await createOnly(join(root, "index.md"), CHARACTER_MIND_INDEX);
  await createOnly(join(root, "log.md"), CHARACTER_MIND_LOG);
}

function capturedAtFilename(date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, "").replace(".", "");
}

async function newestRawPath(root: string, area: RawArea, prefix = ""): Promise<string | null> {
  const dir = join(root, "raw", area);
  if (!(await pathExists(dir))) return null;
  const names = (await readdir(dir)).filter((name) => name.endsWith(".md") && name.startsWith(prefix));
  if (!names.length) return null;
  const newest = (
    await Promise.all(names.map(async (name) => ({ name, modifiedAt: (await stat(join(dir, name))).mtimeMs })))
  )
    .sort((a, b) => a.modifiedAt - b.modifiedAt || a.name.localeCompare(b.name))
    .at(-1)!;
  return `raw/${area}/${newest.name}`;
}

function rawMarkdown(input: {
  sourceType: RawSourceType;
  sourceKey: string;
  revision: string;
  capturedAt: string;
  supersedes: string | null;
  title: string;
  payload: unknown;
}): string {
  return `---\nsource_type: ${input.sourceType}\nsource_key: ${input.sourceKey}\nrevision: ${input.revision}\ncaptured_at: ${input.capturedAt}\nsupersedes: ${input.supersedes ?? "null"}\n---\n\n# ${input.title}\n\nThis is an immutable Marinara raw source. The canonical JSON block is the\ncontent covered by \`revision\`.\n\n\`\`\`json\n${prettyStableJson(input.payload)}\n\`\`\`\n`;
}

async function writeRawSnapshot(input: {
  root: string;
  area: RawArea;
  filenamePrefix: string;
  sourceType: RawSourceType;
  sourceKey: string;
  title: string;
  payload: unknown;
}): Promise<RawSnapshot> {
  const revision = revisionForPayload(input.payload);
  const directory = join(input.root, "raw", input.area);
  await mkdir(directory, { recursive: true });
  const existing = (await readdir(directory)).find(
    (name) => name.endsWith(`--${revision}.md`) && name.startsWith(input.filenamePrefix),
  );
  if (existing) return { path: `raw/${input.area}/${existing}`, revision, created: false, sourceKey: input.sourceKey };
  const capturedAt = new Date().toISOString();
  const previous = await newestRawPath(input.root, input.area, input.filenamePrefix);
  const filename =
    input.area === "character-card"
      ? `${input.filenamePrefix}${capturedAtFilename()}--${revision}.md`
      : `${input.filenamePrefix}${revision}.md`;
  const relativePath = `raw/${input.area}/${filename}`;
  const content = rawMarkdown({ ...input, revision, capturedAt, supersedes: previous });
  if (Buffer.byteLength(content, "utf8") > CHARACTER_MIND_RAW_MAX_BYTES)
    throw new Error("Character Mind raw source exceeds 4 MiB");
  const created = await createOnly(join(input.root, ...relativePath.split("/")), content);
  return { path: relativePath, revision, created, sourceKey: input.sourceKey };
}

export async function snapshotCharacterCard(root: string, payload: CharacterCardRawPayload): Promise<RawSnapshot> {
  return writeRawSnapshot({
    root,
    area: "character-card",
    filenamePrefix: "",
    sourceType: "character-card",
    sourceKey: `character-card:${payload.characterId}:${payload.chatId}`,
    title: `Character Card — ${payload.data.name || "Character"}`,
    payload,
  });
}

export async function snapshotDailyMemories(root: string, payload: DailyMemoryRawPayload): Promise<RawSnapshot> {
  const safeDate = payload.date.replace(/[^0-9A-Za-z.-]/g, "-");
  return writeRawSnapshot({
    root,
    area: "daily-memories",
    filenamePrefix: `${safeDate}--`,
    sourceType: "daily-memories",
    sourceKey: `daily-memories:${payload.chatId}:${payload.date}`,
    title: `Daily Memories — ${payload.date}`,
    payload,
  });
}

export async function snapshotAutoSummary(root: string, payload: AutoSummaryRawPayload): Promise<RawSnapshot> {
  const safeDate = payload.date.replace(/[^0-9A-Za-z.-]/g, "-");
  return writeRawSnapshot({
    root,
    area: `auto-summaries/${payload.period}`,
    filenamePrefix: `${safeDate}--`,
    sourceType: "auto-summary",
    sourceKey: `auto-summary:${payload.chatId}:${payload.period}:${payload.date}`,
    title: `${payload.period === "day" ? "Daily" : "Weekly"} Auto-Summary — ${payload.date}`,
    payload,
  });
}

export async function resetMindSynthesis(root: string): Promise<void> {
  await rm(join(root, "wiki"), { recursive: true, force: true });
  await mkdir(join(root, "wiki"), { recursive: true });
  await atomicWrite(join(root, "index.md"), CHARACTER_MIND_INDEX);
}

export async function writeMindIndex(root: string, content: string): Promise<void> {
  await atomicWrite((await resolveMindMarkdown(root, "index.md")).path, content);
}

export async function readMindIndex(root: string): Promise<string> {
  return readFile((await resolveMindMarkdown(root, "index.md")).path, "utf8");
}

export async function verifyRawMarkdown(
  root: string,
  relativePath: string,
): Promise<{ revision: string; sourceKey: string }> {
  const resolved = await resolveMindMarkdown(root, relativePath);
  if (!resolved.relativePath.startsWith("raw/")) throw new Error("Not a raw Character Mind source");
  const content = await readFile(resolved.path, "utf8");
  if (Buffer.byteLength(content, "utf8") > CHARACTER_MIND_RAW_MAX_BYTES)
    throw new Error("Character Mind raw source exceeds 4 MiB");
  const revision = /^revision:\s*([0-9a-f]{16})\s*$/m.exec(content)?.[1];
  const sourceKey = /^source_key:\s*(.+?)\s*$/m.exec(content)?.[1];
  const block = /```json\s*\r?\n([\s\S]*?)\r?\n```/.exec(content)?.[1];
  if (!revision || !sourceKey || !block) throw new Error(`Invalid raw source: ${relativePath}`);
  let payload: unknown;
  try {
    payload = JSON.parse(block);
  } catch {
    throw new Error(`Invalid canonical JSON in raw source: ${relativePath}`);
  }
  if (revisionForPayload(payload) !== revision) throw new Error(`Raw source integrity check failed: ${relativePath}`);
  return { revision, sourceKey };
}

export async function listMarkdown(root: string, relativeDir = ""): Promise<string[]> {
  const start = relativeDir ? resolve(root, ...relativeDir.replaceAll("\\", "/").split("/")) : root;
  const rel = relative(resolve(root), start);
  if (rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) throw new Error("Path escapes the Character Mind");
  await rejectSymlinks(root, start);
  const results: string[] = [];
  const walk = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
        results.push(relative(root, full).split(sep).join("/"));
      if (results.length >= 500) return;
    }
  };
  if (await pathExists(start)) await walk(start);
  return results.sort();
}

export async function removeChatMinds(chatId: string): Promise<void> {
  await rm(join(characterMindsRoot(), safeSegment(chatId)), { recursive: true, force: true });
}

export async function removeCharacterMinds(characterId: string): Promise<void> {
  const root = characterMindsRoot();
  if (!(await pathExists(root))) return;
  for (const chat of await readdir(root, { withFileTypes: true })) {
    if (!chat.isDirectory() || chat.isSymbolicLink()) continue;
    await rm(join(root, chat.name, safeSegment(characterId)), { recursive: true, force: true });
  }
}

export async function mindDiskPath(root: string): Promise<string> {
  try {
    return await realpath(root);
  } catch {
    return root;
  }
}
