import { rm, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import type {
  MariWorkspaceSkillDetail,
  MariWorkspaceSkillSummary,
  MariWorkspaceSkillsResponse,
} from "@marinara-engine/shared";
import { DATA_DIR } from "../../utils/data-dir.js";
import { now } from "../../utils/id-generator.js";
import { logger } from "../../lib/logger.js";
import { PROFESSOR_MARI_BUNDLED_SKILLS } from "./bundled-skills.js";

type SkillRecord = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

type SkillDraft = {
  name?: string | null;
  description?: string | null;
  content: string;
  fileName?: string | null;
  enabled?: boolean;
};

type SkillUpdate = {
  name?: string | null;
  description?: string | null;
  content?: string | null;
  enabled?: boolean;
};

type BundledSeedState = Record<string, number>;

const MAX_SKILL_CONTENT_LENGTH = 200_000;
const MAX_SKILL_DESCRIPTION_LENGTH = 1024;
const SAFE_SKILL_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

function rootDir() {
  return join(DATA_DIR, ".mari-workspace", "skills");
}

function indexPath() {
  return join(rootDir(), "skills.json");
}

function bundledSeedPath() {
  return join(rootDir(), "bundled-seeds.json");
}

function skillDir(id: string) {
  return join(rootDir(), id);
}

function skillFilePath(id: string) {
  return join(skillDir(id), "SKILL.md");
}

function stripFrontmatter(content: string) {
  return content.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*/, "").trimStart();
}

function skillInstructions(content: string) {
  return stripFrontmatter(content).trim();
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*/);
  if (!match?.[1]) return {};
  const frontmatter: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    const raw = line.slice(separator + 1).trim();
    if (!key) continue;
    frontmatter[key] = raw.replace(/^["']|["']$/g, "");
  }
  return frontmatter;
}

function normalizeSkillName(value: string | null | undefined, fallback = "custom-skill") {
  const source = value?.trim() || fallback;
  const normalized = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 64)
    .replace(/^-+|-+$/g, "");
  return normalized || "custom-skill";
}

function normalizeSkillId(value: string | null | undefined, fallback = "skill") {
  return normalizeSkillName(value, fallback);
}

function assertSafeSkillId(id: string) {
  if (!SAFE_SKILL_ID_PATTERN.test(id)) {
    throw new Error("Invalid skill id");
  }
  return id;
}

function appendSkillIdSuffix(baseId: string, suffix: number) {
  const suffixText = `-${suffix}`;
  const prefix = baseId.slice(0, 64 - suffixText.length).replace(/-+$/g, "") || "skill";
  return `${prefix}${suffixText}`;
}

function titleFromFileName(fileName: string | null | undefined) {
  const base = fileName ? basename(fileName).replace(/\.[^.]+$/, "") : "";
  return base.replace(/[-_]+/g, " ").trim();
}

function titleFromBody(content: string) {
  const match = stripFrontmatter(content).match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() ?? "";
}

function firstBodyLine(content: string) {
  return (
    stripFrontmatter(content)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("#")) ?? ""
  );
}

function normalizeDescription(value: string | null | undefined, content: string) {
  const frontmatter = parseFrontmatter(content);
  const candidate =
    value?.trim() ||
    frontmatter.description?.trim() ||
    firstBodyLine(content) ||
    "User-defined Professor Mari skill.";
  return candidate.slice(0, MAX_SKILL_DESCRIPTION_LENGTH);
}

function buildSkillContent(input: { name: string; description: string; content: string }) {
  const body = skillInstructions(input.content);
  const fallbackBody = `# ${input.name}\n\nAdd focused instructions for when Professor Mari should use this skill.`;
  return [
    "---",
    `name: ${JSON.stringify(input.name)}`,
    `description: ${JSON.stringify(input.description)}`,
    "---",
    "",
    body || fallbackBody,
    "",
  ].join("\n");
}

function summarizeRecord(record: SkillRecord, content: string): MariWorkspaceSkillSummary {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    enabled: record.enabled,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    size: Buffer.byteLength(content, "utf8"),
    filePath: skillFilePath(record.id),
  };
}

export class ProfessorMariWorkspaceSkillsService {
  private storageReady: Promise<void> | null = null;

  async list(): Promise<MariWorkspaceSkillsResponse> {
    await this.ensureStorage();
    const records = await this.readRecords();
    const diagnostics: string[] = [];
    const skills: MariWorkspaceSkillDetail[] = [];

    for (const record of records) {
      try {
        const content = await readFile(skillFilePath(record.id), "utf8");
        skills.push({ ...summarizeRecord(record, content), content: skillInstructions(content) });
      } catch (err) {
        diagnostics.push(`Skill ${record.name} could not be read: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { skills, diagnostics };
  }

  async listSummaries(): Promise<MariWorkspaceSkillSummary[]> {
    const response = await this.list();
    return response.skills.map(({ content: _content, ...summary }) => summary);
  }

  async create(input: SkillDraft): Promise<MariWorkspaceSkillDetail> {
    await this.ensureStorage();
    this.assertContent(input.content);
    const records = await this.readRecords();
    const frontmatter = parseFrontmatter(input.content);
    const name = normalizeSkillName(input.name ?? frontmatter.name, titleFromBody(input.content) || titleFromFileName(input.fileName));
    const id = this.uniqueId(name, records);
    const description = normalizeDescription(input.description, input.content);
    const timestamp = now();
    const record: SkillRecord = {
      id,
      name,
      description,
      enabled: input.enabled ?? true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const content = buildSkillContent({ name, description, content: input.content });
    await mkdir(skillDir(id), { recursive: true });
    await writeFile(skillFilePath(id), content, "utf8");
    await this.writeRecords([...records, record]);
    return { ...summarizeRecord(record, content), content: skillInstructions(content) };
  }

  async update(id: string, input: SkillUpdate): Promise<MariWorkspaceSkillDetail> {
    await this.ensureStorage();
    const safeId = assertSafeSkillId(id);
    const records = await this.readRecords();
    const index = records.findIndex((record) => record.id === safeId);
    if (index < 0) throw new Error("Skill not found");
    const current = records[index]!;

    const previousContent = await readFile(skillFilePath(current.id), "utf8");
    const nextContentSource = input.content ?? skillInstructions(previousContent);
    if (input.content !== undefined && input.content !== null) this.assertContent(input.content);
    const name = normalizeSkillName(input.name ?? parseFrontmatter(nextContentSource).name ?? current.name, current.name);
    const description = normalizeDescription(input.description ?? current.description, nextContentSource);
    const nextRecord: SkillRecord = {
      ...current,
      name,
      description,
      enabled: input.enabled ?? current.enabled,
      updatedAt: now(),
    };
    const nextContent = buildSkillContent({ name, description, content: nextContentSource });
    await writeFile(skillFilePath(current.id), nextContent, "utf8");
    const nextRecords = [...records];
    nextRecords[index] = nextRecord;
    await this.writeRecords(nextRecords);
    return { ...summarizeRecord(nextRecord, nextContent), content: skillInstructions(nextContent) };
  }

  async delete(id: string): Promise<void> {
    await this.ensureStorage();
    const safeId = assertSafeSkillId(id);
    const records = await this.readRecords();
    const record = records.find((entry) => entry.id === safeId);
    if (!record) throw new Error("Skill not found");
    await rm(skillDir(record.id), { recursive: true, force: true });
    await this.writeRecords(records.filter((entry) => entry.id !== record.id));
  }

  private async ensureStorage() {
    if (!this.storageReady) {
      this.storageReady = this.ensureStorageOnce().catch((err) => {
        this.storageReady = null;
        throw err;
      });
    }
    await this.storageReady;
  }

  private async ensureStorageOnce() {
    await mkdir(rootDir(), { recursive: true });
    await this.seedBundledSkills();
  }

  private async seedBundledSkills() {
    const seedState = await this.readBundledSeedState();
    let records = await this.readRecords();
    let recordsChanged = false;
    let seedStateChanged = false;

    for (const bundled of PROFESSOR_MARI_BUNDLED_SKILLS) {
      if ((seedState[bundled.key] ?? 0) >= bundled.version) continue;

      const existing = records.find((record) => record.id === bundled.id);
      if (!existing) {
        this.assertContent(bundled.content);
        const timestamp = now();
        const record: SkillRecord = {
          id: assertSafeSkillId(bundled.id),
          name: normalizeSkillName(bundled.name, bundled.id),
          description: normalizeDescription(bundled.description, bundled.content),
          enabled: bundled.enabled,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        const content = buildSkillContent({
          name: record.name,
          description: record.description,
          content: bundled.content,
        });
        await mkdir(skillDir(record.id), { recursive: true });
        await writeFile(skillFilePath(record.id), content, "utf8");
        records = [...records, record];
        recordsChanged = true;
      }

      seedState[bundled.key] = bundled.version;
      seedStateChanged = true;
    }

    if (recordsChanged) await this.writeRecords(records);
    if (seedStateChanged) await this.writeBundledSeedState(seedState);
  }

  private async readBundledSeedState(): Promise<BundledSeedState> {
    if (!existsSync(bundledSeedPath())) return {};
    try {
      const parsed = JSON.parse(await readFile(bundledSeedPath(), "utf8")) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      const state: BundledSeedState = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (Number.isSafeInteger(value) && Number(value) >= 0) state[key] = Number(value);
      }
      return state;
    } catch (err) {
      logger.warn(err, "[Professor Mari] failed to read bundled skill seed state");
      return {};
    }
  }

  private async writeBundledSeedState(state: BundledSeedState) {
    await mkdir(rootDir(), { recursive: true });
    const target = bundledSeedPath();
    const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(temporary, JSON.stringify(state, null, 2), "utf8");
    await rename(temporary, target);
  }

  private async readRecords(): Promise<SkillRecord[]> {
    if (!existsSync(indexPath())) return [];
    try {
      const parsed = JSON.parse(await readFile(indexPath(), "utf8")) as unknown;
      if (!Array.isArray(parsed)) return [];
      const records: SkillRecord[] = [];
      const usedIds = new Set<string>();
      for (const entry of parsed.filter((entry): entry is Partial<SkillRecord> => !!entry && typeof entry === "object")) {
        const baseId = normalizeSkillId(typeof entry.id === "string" ? entry.id : entry.name, "skill");
        let id = baseId;
        let suffix = 2;
        while (usedIds.has(id)) {
          id = appendSkillIdSuffix(baseId, suffix);
          suffix += 1;
        }
        usedIds.add(id);
        records.push({
          id,
          name: normalizeSkillName(entry.name, "skill"),
          description:
            typeof entry.description === "string" && entry.description.trim()
              ? entry.description.slice(0, MAX_SKILL_DESCRIPTION_LENGTH)
              : "User-defined Professor Mari skill.",
          enabled: entry.enabled !== false,
          createdAt: typeof entry.createdAt === "string" ? entry.createdAt : now(),
          updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : now(),
        });
      }
      return records;
    } catch (err) {
      logger.warn(err, "[Professor Mari] failed to read workspace skill index");
      return [];
    }
  }

  private async writeRecords(records: SkillRecord[]) {
    await mkdir(rootDir(), { recursive: true });
    await writeFile(indexPath(), JSON.stringify(records, null, 2), "utf8");
  }

  private uniqueId(baseName: string, records: SkillRecord[]) {
    const existing = new Set(records.map((record) => record.id));
    let id = baseName;
    let suffix = 2;
    while (existing.has(id)) {
      id = appendSkillIdSuffix(baseName, suffix);
      suffix += 1;
    }
    return id;
  }

  private assertContent(content: string) {
    if (!skillInstructions(content)) throw new Error("Skill instructions are required.");
    if (content.length > MAX_SKILL_CONTENT_LENGTH) {
      throw new Error(`Skill content must be ${MAX_SKILL_CONTENT_LENGTH} characters or fewer.`);
    }
  }
}

let singleton: ProfessorMariWorkspaceSkillsService | null = null;
export function getProfessorMariWorkspaceSkillsService() {
  if (!singleton) singleton = new ProfessorMariWorkspaceSkillsService();
  return singleton;
}
