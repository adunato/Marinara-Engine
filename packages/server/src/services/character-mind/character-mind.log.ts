import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { atomicWrite, pathExists, resolveMindMarkdown } from "./character-mind.files.js";
import type { CharacterMindTrace } from "./character-mind.tools.js";

export interface ParsedMindLogEntry {
  timestamp: string;
  operation: string;
  subject: string;
  status: "success" | "failure";
  revision?: string;
}

export async function readMindLog(root: string): Promise<string> {
  const path = (await resolveMindMarkdown(root, "log.md")).path;
  return (await pathExists(path)) ? readFile(path, "utf8") : "";
}

export function parseMindLog(content: string): ParsedMindLogEntry[] {
  const entries: ParsedMindLogEntry[] = [];
  for (const block of content.split(/(?=^## \[)/m)) {
    const match = /^## \[([^\]]+)] ([a-z-]+) \| (.+?)\r?\n([\s\S]*)$/.exec(block.trim());
    if (!match) continue;
    const body = match[4] ?? "";
    const status = /^- status:\s*(success|failure)\s*$/m.exec(body)?.[1];
    if (status !== "success" && status !== "failure") continue;
    const revision = /^- revision:\s*([0-9a-f]{16})\s*$/m.exec(body)?.[1];
    entries.push({
      timestamp: match[1]!,
      operation: match[2]!,
      subject: match[3]!,
      status,
      ...(revision ? { revision } : {}),
    });
  }
  return entries;
}

function links(paths: Iterable<string>): string {
  return [...paths].map((path) => `[[${path.replace(/\.md$/i, "")}]]`).join(", ") || "none";
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 1000);
}

export async function appendMindLog(input: {
  root: string;
  operation: "ingest" | "query" | "lint";
  subject: string;
  status: "success" | "failure";
  trace: CharacterMindTrace;
  revision?: string;
  summary?: string;
  findings?: string[];
  error?: string;
}): Promise<void> {
  const timestamp = new Date().toISOString();
  const lines = [
    `## [${timestamp}] ${input.operation} | ${input.subject}`,
    "",
    `- status: ${input.status}`,
    ...(input.revision ? [`- revision: ${input.revision}`] : []),
    `- read: ${links(input.trace.read)}`,
    `- created: ${links(input.trace.created)}`,
    `- updated: ${links(input.trace.updated)}`,
    ...(input.trace.moved.size ? [`- moved: ${oneLine([...input.trace.moved].join(", "))}`] : []),
    ...(input.trace.deleted.size ? [`- deleted: ${links(input.trace.deleted)}`] : []),
    ...(input.findings?.length ? [`- findings: ${oneLine(input.findings.join(" | "))}`] : []),
    ...(input.summary ? [`- summary: ${oneLine(input.summary)}`] : []),
    ...(input.error ? [`- error: ${oneLine(input.error)}`] : []),
    "",
  ];
  const path = (await resolveMindMarkdown(input.root, "log.md")).path;
  const existing = await readMindLog(input.root);
  await atomicWrite(path, `${existing.trimEnd()}\n\n${lines.join("\n")}`);
}

export function successfulIngestRevisions(entries: ParsedMindLogEntry[]): Set<string> {
  return new Set(
    entries
      .filter((entry) => entry.operation === "ingest" && entry.status === "success" && entry.revision)
      .map((entry) => entry.revision!),
  );
}

export function ingestsSinceLastLint(entries: ParsedMindLogEntry[]): number {
  let lastLint = -1;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    if (entry.operation === "lint" && entry.status === "success") {
      lastLint = index;
      break;
    }
  }
  return entries.slice(lastLint + 1).filter((entry) => entry.operation === "ingest" && entry.status === "success")
    .length;
}

export function queryLogSubject(query: string): string {
  return createHash("sha256").update(query, "utf8").digest("hex").slice(0, 4);
}
