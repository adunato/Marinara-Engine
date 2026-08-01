import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { atomicWrite, normalizeMindPath, pathExists, resolveMindMarkdown } from "./character-mind.files.js";
import type { CharacterMindTrace } from "./character-mind.tools.js";

interface LivePrecondition {
  content: string | null;
  hash: string | null;
}

function contentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export class CharacterMindCandidateSet {
  readonly root: string;
  readonly liveRoot: string;
  readonly deleted = new Set<string>();
  readonly moves = new Map<string, string>();
  private readonly preconditions = new Map<string, LivePrecondition>();
  private readonly candidates = new Set<string>();

  private constructor(liveRoot: string, root: string) {
    this.liveRoot = liveRoot;
    this.root = root;
  }

  static async create(liveRoot: string): Promise<CharacterMindCandidateSet> {
    const prefix = join(dirname(liveRoot), `.${basename(liveRoot)}-candidate-`);
    return new CharacterMindCandidateSet(liveRoot, await mkdtemp(prefix));
  }

  async dispose(): Promise<void> {
    await rm(this.root, { recursive: true, force: true });
  }

  private async capture(path: string): Promise<LivePrecondition> {
    const normalized = normalizeMindPath(path);
    const existing = this.preconditions.get(normalized);
    if (existing) return existing;
    const resolved = await resolveMindMarkdown(this.liveRoot, normalized);
    const content = (await pathExists(resolved.path)) ? await readFile(resolved.path, "utf8") : null;
    const captured = { content, hash: content === null ? null : contentHash(content) };
    this.preconditions.set(normalized, captured);
    return captured;
  }

  async requireExisting(path: string): Promise<string> {
    const normalized = normalizeMindPath(path);
    const captured = await this.capture(normalized);
    if (captured.content === null) throw new Error(`Character Mind target does not exist: ${normalized}`);
    return captured.content;
  }

  async requireAbsent(path: string): Promise<void> {
    const normalized = normalizeMindPath(path);
    if ((await this.capture(normalized)).content !== null)
      throw new Error(`Character Mind target already exists: ${normalized}`);
  }

  async read(path: string): Promise<string> {
    const normalized = normalizeMindPath(path);
    if (this.deleted.has(normalized)) throw new Error(`Character Mind candidate was deleted: ${normalized}`);
    const candidate = await resolveMindMarkdown(this.root, normalized);
    if (await pathExists(candidate.path)) return readFile(candidate.path, "utf8");
    return this.requireExisting(normalized);
  }

  async write(path: string, content: string): Promise<void> {
    const normalized = normalizeMindPath(path);
    await this.capture(normalized);
    await atomicWrite((await resolveMindMarkdown(this.root, normalized)).path, content);
    this.deleted.delete(normalized);
    this.candidates.add(normalized);
  }

  async edit(path: string, oldText: string, newText: string): Promise<void> {
    const normalized = normalizeMindPath(path);
    if (!oldText) throw new Error("oldText must not be empty");
    if (Buffer.byteLength(oldText, "utf8") > 16 * 1024 || Buffer.byteLength(newText, "utf8") > 16 * 1024)
      throw new Error("Character Mind edit fragments must not exceed 16 KiB");
    const content = await this.read(normalized);
    const first = content.indexOf(oldText);
    if (first < 0) throw new Error(`Exact edit text was not found in ${normalized}`);
    if (content.indexOf(oldText, first + oldText.length) >= 0)
      throw new Error(`Exact edit text is ambiguous in ${normalized}`);
    await this.write(normalized, `${content.slice(0, first)}${newText}${content.slice(first + oldText.length)}`);
  }

  async move(from: string, to: string): Promise<void> {
    const source = normalizeMindPath(from);
    const target = normalizeMindPath(to);
    if (source === target) throw new Error("Character Mind move source and target must differ");
    const content = await this.requireExisting(source);
    await this.requireAbsent(target);
    await this.write(target, content);
    this.deleted.add(source);
    this.moves.set(source, target);
  }

  async delete(path: string): Promise<void> {
    const normalized = normalizeMindPath(path);
    await this.requireExisting(normalized);
    this.deleted.add(normalized);
    this.candidates.delete(normalized);
    await rm((await resolveMindMarkdown(this.root, normalized)).path, { force: true });
  }

  candidatePaths(): string[] {
    return [...this.candidates];
  }

  affectedPaths(): string[] {
    return [...new Set([...this.preconditions.keys(), ...this.candidates, ...this.deleted])];
  }

  async publish(trace: CharacterMindTrace): Promise<void> {
    for (const [path, expected] of this.preconditions) {
      const resolved = await resolveMindMarkdown(this.liveRoot, path);
      const content = (await pathExists(resolved.path)) ? await readFile(resolved.path, "utf8") : null;
      const hash = content === null ? null : contentHash(content);
      if (hash !== expected.hash)
        throw new Error(`Character Mind publication conflict: ${path} changed during the operation`);
    }

    try {
      for (const path of this.candidates) {
        const content = await readFile((await resolveMindMarkdown(this.root, path)).path, "utf8");
        await atomicWrite((await resolveMindMarkdown(this.liveRoot, path)).path, content);
      }
      for (const path of this.deleted) await rm((await resolveMindMarkdown(this.liveRoot, path)).path, { force: true });
    } catch (error) {
      for (const [path, original] of this.preconditions) {
        const resolved = await resolveMindMarkdown(this.liveRoot, path);
        if (original.content === null) await rm(resolved.path, { force: true });
        else await atomicWrite(resolved.path, original.content);
      }
      throw error;
    }

    const movedSources = new Set(this.moves.keys());
    const movedTargets = new Set(this.moves.values());
    for (const [from, to] of this.moves) trace.moved.add(`${from} -> ${to}`);
    for (const path of this.candidates) {
      if (movedTargets.has(path)) continue;
      const original = this.preconditions.get(path);
      (original?.content === null ? trace.created : trace.updated).add(path);
    }
    for (const path of this.deleted) if (!movedSources.has(path)) trace.deleted.add(path);
  }
}
