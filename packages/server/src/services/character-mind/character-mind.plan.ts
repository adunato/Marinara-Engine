import type { CharacterMindPagePlan, CharacterMindPlanResult } from "@marinara-engine/shared";
import { normalizeMindPath } from "./character-mind.files.js";

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
