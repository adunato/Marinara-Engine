import { readFile } from "node:fs/promises";
import type { CharacterMindPagePlan, CharacterMindPlanResult } from "@marinara-engine/shared";
import { listMarkdown, normalizeMindPath, pathExists, resolveMindMarkdown } from "./character-mind.files.js";
import { extractWikilinks, wikilinkPath, type CharacterMindTrace } from "./character-mind.tools.js";

const PAGE_HEADING = /^### \[\[(wiki\/[^|\]]+\.md)\|([^\]]+)\]\]$/u;
const SOURCE_LINK = /^- \[\[(raw\/[^\]]+\.md)\]\]$/u;
const EXCLUDED_SOURCE = /^- \[\[(raw\/[^\]]+\.md)\]\] — (.+)$/u;

function oneLine(value: string): string {
  return value
    .replace(/[\r\n\[\]|]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function renderCharacterMindPlan(plan: CharacterMindPlanResult): string {
  const lines = [
    "# Index",
    "",
    "Corpus-level page map created before wiki materialization. This map is also Marinara's resumable build checkpoint.",
    "",
    "## Corpus Summary",
    "",
    oneLine(plan.summary),
    "",
    "## Planned Pages",
    "",
  ];
  for (const page of plan.pages) {
    lines.push(
      `### [[${page.path}|${oneLine(page.title)}]]`,
      "",
      oneLine(page.purpose),
      "",
      "#### Sources",
      "",
      ...page.sources.map((source) => `- [[${source}]]`),
      "",
    );
  }
  lines.push("## Excluded Sources", "");
  if (plan.excludedSources.length === 0) lines.push("None.");
  else {
    for (const excluded of plan.excludedSources) lines.push(`- [[${excluded.path}]] — ${oneLine(excluded.reason)}`);
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function parseCharacterMindPlan(content: string): CharacterMindPlanResult | null {
  try {
    return parseCharacterMindPlanContent(content);
  } catch {
    return null;
  }
}

function parseCharacterMindPlanContent(content: string): CharacterMindPlanResult | null {
  const lines = content.split(/\r?\n/u);
  const summaryHeading = lines.indexOf("## Corpus Summary");
  const pagesHeading = lines.indexOf("## Planned Pages");
  const excludedHeading = lines.indexOf("## Excluded Sources");
  if (summaryHeading < 0 || pagesHeading <= summaryHeading || excludedHeading <= pagesHeading) return null;
  const summary = lines
    .slice(summaryHeading + 1, pagesHeading)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
  if (!summary) return null;

  const pages: CharacterMindPagePlan[] = [];
  let cursor = pagesHeading + 1;
  while (cursor < excludedHeading) {
    const line = lines[cursor]!.trim();
    if (!line) {
      cursor += 1;
      continue;
    }
    const heading = PAGE_HEADING.exec(line);
    if (!heading) return null;
    const path = normalizeMindPath(heading[1]!);
    const title = heading[2]!.trim();
    cursor += 1;
    const purposeLines: string[] = [];
    while (cursor < excludedHeading && lines[cursor]!.trim() !== "#### Sources") {
      const purposeLine = lines[cursor]!.trim();
      if (purposeLine) purposeLines.push(purposeLine);
      cursor += 1;
    }
    if (cursor >= excludedHeading || !title || purposeLines.length === 0) return null;
    cursor += 1;
    const sources: string[] = [];
    while (cursor < excludedHeading) {
      const sourceLine = lines[cursor]!.trim();
      if (!sourceLine) {
        cursor += 1;
        continue;
      }
      if (PAGE_HEADING.test(sourceLine)) break;
      const source = SOURCE_LINK.exec(sourceLine);
      if (!source) return null;
      sources.push(normalizeMindPath(source[1]!));
      cursor += 1;
    }
    if (sources.length === 0) return null;
    pages.push({ path, title, purpose: purposeLines.join(" "), sources });
  }
  if (pages.length === 0 || new Set(pages.map((page) => page.path.toLowerCase())).size !== pages.length) return null;

  const excludedSources: CharacterMindPlanResult["excludedSources"] = [];
  for (const rawLine of lines.slice(excludedHeading + 1)) {
    const line = rawLine.trim();
    if (!line || line === "None.") continue;
    const excluded = EXCLUDED_SOURCE.exec(line);
    if (!excluded) return null;
    excludedSources.push({ path: normalizeMindPath(excluded[1]!), reason: excluded[2]!.trim() });
  }
  return { summary, pages, excludedSources };
}

export function characterMindPlanMatchesSources(plan: CharacterMindPlanResult, sourcePaths: string[]): boolean {
  const expected = new Set(sourcePaths);
  const used = new Set(plan.pages.flatMap((page) => page.sources));
  const excluded = new Set(plan.excludedSources.map((item) => item.path));
  if (excluded.size !== plan.excludedSources.length) return false;
  if ([...excluded].some((path) => used.has(path))) return false;
  const accounted = new Set([...used, ...excluded]);
  return accounted.size === expected.size && [...accounted].every((path) => expected.has(path));
}

export function pendingCharacterMindPages(
  plan: CharacterMindPlanResult,
  completedPaths: ReadonlySet<string>,
  existingPaths: ReadonlySet<string>,
): CharacterMindPagePlan[] {
  return plan.pages.filter((page) => !completedPaths.has(page.path) || !existingPaths.has(page.path));
}

export type CharacterMindChangeAction =
  | { type: "create" | "edit" | "replace"; path: string; sources: string[]; reason: string }
  | { type: "rename"; from: string; to: string; reason: string }
  | { type: "delete"; path: string; reason: string }
  | { type: "index-edit" | "index-replace"; path: "index.md"; reason: string };

export interface CharacterMindChangePlan {
  summary: string;
  findings: string[];
  actions: CharacterMindChangeAction[];
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Character Mind change plan ${field} is required`);
  return value.trim();
}

function flatWikiPath(value: unknown, field: string): string {
  const path = normalizeMindPath(requiredText(value, field));
  if (!/^wiki\/[^/]+\.md$/i.test(path)) throw new Error(`${field} must be a flat wiki/*.md path`);
  return path;
}

function textList(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

export async function validateCharacterMindChangePlan(
  root: string,
  value: Record<string, unknown>,
  trace: CharacterMindTrace,
  operation: "ingest" | "lint",
  requiredSource?: string,
): Promise<CharacterMindChangePlan> {
  const summary = requiredText(value.summary, "summary");
  if (!Array.isArray(value.actions) || value.actions.length > 40)
    throw new Error("Character Mind change plan actions must be an array of at most 40 entries");
  const findings = textList(value.findings);
  const actions: CharacterMindChangeAction[] = [];
  const claimed = new Set<string>();
  let indexActions = 0;
  for (const [index, candidate] of value.actions.entries()) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      throw new Error(`Character Mind change action ${index + 1} is invalid`);
    const item = candidate as Record<string, unknown>;
    const type = requiredText(item.type, `action ${index + 1} type`);
    const reason = requiredText(item.reason, `action ${index + 1} reason`);
    if (type === "create" || type === "edit" || type === "replace") {
      const path = flatWikiPath(item.path, `action ${index + 1} path`);
      const sources = textList(item.sources).map((source) => normalizeMindPath(source));
      if (sources.length === 0 || sources.some((source) => !source.startsWith("raw/")))
        throw new Error(`Character Mind ${type} action requires raw source paths`);
      for (const source of sources) {
        if (!(await pathExists((await resolveMindMarkdown(root, source)).path)))
          throw new Error(`Character Mind change action references a missing source: ${source}`);
      }
      const exists = await pathExists((await resolveMindMarkdown(root, path)).path);
      if (type === "create" ? exists : !exists)
        throw new Error(`Character Mind ${type} precondition failed for ${path}`);
      if (claimed.has(path.toLowerCase())) throw new Error(`Character Mind plan changes ${path} more than once`);
      claimed.add(path.toLowerCase());
      actions.push({ type, path, sources: [...new Set(sources)], reason });
      continue;
    }
    if (type === "rename") {
      const from = flatWikiPath(item.from, `action ${index + 1} from`);
      const to = flatWikiPath(item.to, `action ${index + 1} to`);
      if (!(await pathExists((await resolveMindMarkdown(root, from)).path)))
        throw new Error(`Character Mind rename source is missing: ${from}`);
      if (await pathExists((await resolveMindMarkdown(root, to)).path))
        throw new Error(`Character Mind rename target exists: ${to}`);
      if (claimed.has(from.toLowerCase()) || claimed.has(to.toLowerCase()))
        throw new Error(`Character Mind plan has overlapping rename: ${from} -> ${to}`);
      claimed.add(from.toLowerCase());
      claimed.add(to.toLowerCase());
      actions.push({ type, from, to, reason });
      continue;
    }
    if (type === "delete") {
      const path = flatWikiPath(item.path, `action ${index + 1} path`);
      if (!(await pathExists((await resolveMindMarkdown(root, path)).path)))
        throw new Error(`Character Mind delete target is missing: ${path}`);
      if (claimed.has(path.toLowerCase())) throw new Error(`Character Mind plan changes ${path} more than once`);
      claimed.add(path.toLowerCase());
      actions.push({ type, path, reason });
      continue;
    }
    if (type === "index-edit" || type === "index-replace") {
      indexActions += 1;
      if (indexActions > 1) throw new Error("Character Mind plan contains more than one index action");
      actions.push({ type, path: "index.md", reason });
      continue;
    }
    throw new Error(`Unknown Character Mind change action type: ${type}`);
  }

  const topology = actions.filter((action) => ["create", "rename", "delete"].includes(action.type));
  if (topology.length > 0 && indexActions === 0)
    throw new Error("Character Mind topology changes require an index-edit or index-replace action");

  const destructive = new Set(
    actions.flatMap((action) =>
      action.type === "delete"
        ? [action.path.toLowerCase()]
        : action.type === "rename"
          ? [action.from.toLowerCase()]
          : [],
    ),
  );
  if (destructive.size > 0) {
    const changedPages = new Set(
      actions.flatMap((action) =>
        action.type === "edit" || action.type === "replace" || action.type === "delete"
          ? [action.path.toLowerCase()]
          : action.type === "rename"
            ? [action.from.toLowerCase()]
            : [],
      ),
    );
    for (const path of (await listMarkdown(root)).filter((path) => path === "index.md" || path.startsWith("wiki/"))) {
      const links = extractWikilinks(await readFile((await resolveMindMarkdown(root, path)).path, "utf8"));
      if (!links.some((link) => destructive.has(wikilinkPath(path, link).toLowerCase()))) continue;
      if (path === "index.md" ? indexActions === 0 : !changedPages.has(path.toLowerCase()))
        throw new Error(`Character Mind change plan omits inbound-link repair for ${path}`);
    }
  }

  if (operation === "ingest" && requiredSource && !trace.verifiedRaw.has(requiredSource))
    throw new Error(`Character Mind ingest discovery did not read ${requiredSource}`);
  if (operation === "lint") {
    const pages = (await listMarkdown(root, "wiki")).filter((path) => path.startsWith("wiki/"));
    if (!trace.listed.some((path) => path === "wiki" || path === ""))
      throw new Error("Character Mind lint discovery did not list the wiki");
    const unread = pages.filter((path) => !trace.read.has(path));
    if (unread.length) throw new Error(`Character Mind lint discovery did not read: ${unread.join(", ")}`);
  }
  return { summary, findings, actions };
}
