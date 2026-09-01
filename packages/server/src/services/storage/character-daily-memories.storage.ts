import type {
  CharacterDailyMemory,
  CharacterDailyMemoryDay,
  CharacterDailyMemoryDayStatus,
  CharacterDailyMemoryOrigin,
  CharacterDailyMemoryRun,
  CharacterDailyMemoryRunKind,
  CharacterDailyMemoryRunSource,
  CharacterDailyMemoryRunStatus,
  CharacterDailyMemorySettings,
  CharacterDailyMemorySettingsPatch,
  CharacterDailyMemoryWindow,
} from "@marinara-engine/shared";
import { CHARACTER_DAILY_MEMORY_DEFAULT_PROMPT } from "@marinara-engine/shared";
import { and, asc, eq, inArray } from "../../db/file-query.js";
import type { DB } from "../../db/connection.js";
import {
  characterDailyMemories,
  characterDailyMemoryDays,
  characterDailyMemoryRunSources,
  characterDailyMemoryRuns,
  characterDailyMemorySettings,
} from "../../db/schema/index.js";
import { newId, now } from "../../utils/id-generator.js";
import { mostRecentCompletedWindow } from "../character-daily-memories/window.js";

type SettingsRow = typeof characterDailyMemorySettings.$inferSelect;
type DayRow = typeof characterDailyMemoryDays.$inferSelect;
type RunRow = typeof characterDailyMemoryRuns.$inferSelect;
type SourceRow = typeof characterDailyMemoryRunSources.$inferSelect;
type MemoryRow = typeof characterDailyMemories.$inferSelect;

const bool = (value: unknown): boolean => value === true || value === "true";
const jsonArray = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
};
const jsonVector = (value: unknown): number[] | null => {
  if (Array.isArray(value))
    return value.every((item) => typeof item === "number" && Number.isFinite(item)) ? value : null;
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "number" && Number.isFinite(item))
      ? parsed
      : null;
  } catch {
    return null;
  }
};

function mapSettings(row: SettingsRow): CharacterDailyMemorySettings {
  return { ...row, enabled: bool(row.enabled), formationConnectionId: row.formationConnectionId ?? null };
}
function mapDay(row: DayRow): CharacterDailyMemoryDay {
  return { ...row, timeZone: row.timeZone ?? null, activeRunId: row.activeRunId ?? null };
}
function mapRun(row: RunRow): CharacterDailyMemoryRun {
  return {
    ...row,
    sourceConversationIds: jsonArray(row.sourceConversationIds),
    connectionId: row.connectionId ?? null,
    model: row.model ?? null,
    replacementOfRunId: row.replacementOfRunId ?? null,
    startedAt: row.startedAt ?? null,
    completedAt: row.completedAt ?? null,
  };
}
function mapSource(row: SourceRow): CharacterDailyMemoryRunSource {
  return { ...row, lastError: row.lastError ?? null, nextRetryAt: row.nextRetryAt ?? null };
}
function mapMemory(row: MemoryRow): CharacterDailyMemory {
  return {
    ...row,
    runSourceId: row.runSourceId ?? null,
    sourceConversationId: row.sourceConversationId ?? null,
    sourceConversationName: row.sourceConversationName ?? null,
    embedding: jsonVector(row.embedding),
    embeddingSpaceId: row.embeddingSpaceId ?? null,
  };
}

export type CreateRunInput = {
  dayId: string;
  kind: CharacterDailyMemoryRunKind;
  sourceConversationIds?: string[];
  connectionId?: string | null;
  model?: string | null;
  replacementOfRunId?: string | null;
  status?: CharacterDailyMemoryRunStatus;
};
export type CreateRunSourceInput = { runId: string; sourceConversationId: string; sourceConversationName?: string };
export type CreateMemoryInput = {
  characterId: string;
  dayId: string;
  runId: string;
  runSourceId?: string | null;
  origin: CharacterDailyMemoryOrigin;
  sourceConversationId?: string | null;
  sourceConversationName?: string | null;
  text: string;
  importance: number;
  embedding?: number[] | null;
  embeddingSpaceId?: string | null;
};

export function createCharacterDailyMemoriesStorage(db: DB) {
  const getDayOwned = async (dayId: string, characterId?: string): Promise<DayRow> => {
    const rows = await db.select().from(characterDailyMemoryDays).where(eq(characterDailyMemoryDays.id, dayId));
    const row = rows[0];
    if (!row || (characterId && row.characterId !== characterId)) throw new Error("Daily memory day was not found");
    return row;
  };
  const getRunOwned = async (runId: string, characterId?: string): Promise<RunRow> => {
    const rows = await db.select().from(characterDailyMemoryRuns).where(eq(characterDailyMemoryRuns.id, runId));
    const row = rows[0];
    if (!row) throw new Error("Daily memory run was not found");
    if (characterId) await getDayOwned(row.dayId, characterId);
    return row;
  };
  const getSourceOwned = async (runSourceId: string, characterId?: string): Promise<SourceRow> => {
    const rows = await db
      .select()
      .from(characterDailyMemoryRunSources)
      .where(eq(characterDailyMemoryRunSources.id, runSourceId));
    const row = rows[0];
    if (!row) throw new Error("Daily memory source was not found");
    if (characterId) await getRunOwned(row.runId, characterId);
    return row;
  };

  return {
    async getSettings(characterId: string): Promise<CharacterDailyMemorySettings | null> {
      const rows = await db
        .select()
        .from(characterDailyMemorySettings)
        .where(eq(characterDailyMemorySettings.characterId, characterId));
      return rows[0] ? mapSettings(rows[0]) : null;
    },

    async saveSettings(
      characterId: string,
      patch: CharacterDailyMemorySettingsPatch & { timeZone?: string },
    ): Promise<CharacterDailyMemorySettings> {
      return db.transaction(async (tx) => {
        const rows = await tx
          .select()
          .from(characterDailyMemorySettings)
          .where(eq(characterDailyMemorySettings.characterId, characterId));
        const previous = rows[0];
        const timestamp = now();
        const nextEnabled = patch.enabled ?? (previous ? bool(previous.enabled) : false);
        const timeZone = patch.timeZone;
        const handoverTime = patch.handoverTime ?? previous?.handoverTime ?? "04:00";
        const enabledChanged = !previous || bool(previous.enabled) !== nextEnabled;
        const anchor =
          enabledChanged && nextEnabled
            ? mostRecentCompletedWindow(new Date(), handoverTime, timeZone).windowEndAt
            : (previous?.autoStartWindowEndAt ?? null);
        const values = {
          characterId,
          enabled: nextEnabled ? "true" : "false",
          handoverTime,
          formationConnectionId:
            patch.formationConnectionId !== undefined
              ? patch.formationConnectionId
              : (previous?.formationConnectionId ?? null),
          formationPrompt: patch.formationPrompt ?? previous?.formationPrompt ?? CHARACTER_DAILY_MEMORY_DEFAULT_PROMPT,
          retrievalMessageCount: patch.retrievalMessageCount ?? previous?.retrievalMessageCount ?? 20,
          semanticWeight: patch.semanticWeight ?? previous?.semanticWeight ?? 50,
          importanceWeight: patch.importanceWeight ?? previous?.importanceWeight ?? 35,
          recencyWeight: patch.recencyWeight ?? previous?.recencyWeight ?? 15,
          minimumRankPercent: patch.minimumRankPercent ?? previous?.minimumRankPercent ?? 30,
          autoStartWindowEndAt: anchor,
          createdAt: previous?.createdAt ?? timestamp,
          updatedAt: timestamp,
        };
        if (previous)
          await tx
            .update(characterDailyMemorySettings)
            .set(values)
            .where(eq(characterDailyMemorySettings.characterId, characterId));
        else await tx.insert(characterDailyMemorySettings).values(values);
        return mapSettings(values as SettingsRow);
      });
    },

    async listDays(characterId: string): Promise<CharacterDailyMemoryDay[]> {
      const rows = await db
        .select()
        .from(characterDailyMemoryDays)
        .where(eq(characterDailyMemoryDays.characterId, characterId))
        .orderBy(asc(characterDailyMemoryDays.windowEndAt));
      return rows.map(mapDay);
    },
    async getDay(dayId: string, characterId?: string): Promise<CharacterDailyMemoryDay | null> {
      const rows = await db.select().from(characterDailyMemoryDays).where(eq(characterDailyMemoryDays.id, dayId));
      if (!rows[0] || (characterId && rows[0].characterId !== characterId)) return null;
      return mapDay(rows[0]);
    },
    async getDayByWindow(characterId: string, windowEndAt: string): Promise<CharacterDailyMemoryDay | null> {
      const rows = await db
        .select()
        .from(characterDailyMemoryDays)
        .where(
          and(
            eq(characterDailyMemoryDays.characterId, characterId),
            eq(characterDailyMemoryDays.windowEndAt, windowEndAt),
          ),
        );
      return rows[0] ? mapDay(rows[0]) : null;
    },
    async createDay(
      characterId: string,
      window: CharacterDailyMemoryWindow,
      status: CharacterDailyMemoryDayStatus = "pending",
    ): Promise<CharacterDailyMemoryDay> {
      const existing = await this.getDayByWindow(characterId, window.windowEndAt);
      if (existing) return existing;
      const timestamp = now();
      const row = {
        id: newId(),
        characterId,
        dayKey: window.dayKey,
        windowStartAt: window.windowStartAt,
        windowEndAt: window.windowEndAt,
        timeZone: window.timeZone ?? null,
        handoverTime: window.handoverTime,
        status,
        activeRunId: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await db.insert(characterDailyMemoryDays).values(row);
      return mapDay(row as DayRow);
    },
    async updateDay(
      dayId: string,
      patch: Partial<Pick<CharacterDailyMemoryDay, "status" | "activeRunId">>,
      characterId?: string,
    ): Promise<CharacterDailyMemoryDay> {
      const current = await getDayOwned(dayId, characterId);
      const row = { ...patch, updatedAt: now() };
      await db.update(characterDailyMemoryDays).set(row).where(eq(characterDailyMemoryDays.id, dayId));
      return mapDay({ ...current, ...row } as DayRow);
    },
    async markDayDeleted(dayId: string, characterId?: string): Promise<CharacterDailyMemoryDay> {
      return db.transaction(async (tx) => {
        const current = await getDayOwned(dayId, characterId);
        const timestamp = now();
        await tx
          .update(characterDailyMemoryDays)
          .set({ status: "deleted", activeRunId: null, updatedAt: timestamp })
          .where(eq(characterDailyMemoryDays.id, dayId));
        return mapDay({ ...current, status: "deleted", activeRunId: null, updatedAt: timestamp } as DayRow);
      });
    },

    async getRun(runId: string, characterId?: string): Promise<CharacterDailyMemoryRun | null> {
      const row = await getRunOwned(runId, characterId).catch(() => null);
      return row ? mapRun(row) : null;
    },
    async listRuns(dayId: string, characterId?: string): Promise<CharacterDailyMemoryRun[]> {
      await getDayOwned(dayId, characterId);
      const rows = await db
        .select()
        .from(characterDailyMemoryRuns)
        .where(eq(characterDailyMemoryRuns.dayId, dayId))
        .orderBy(asc(characterDailyMemoryRuns.createdAt));
      return rows.map(mapRun);
    },
    async createRun(input: CreateRunInput, characterId?: string): Promise<CharacterDailyMemoryRun> {
      await getDayOwned(input.dayId, characterId);
      const existing = input.sourceConversationIds ?? [];
      const timestamp = now();
      const row = {
        id: newId(),
        dayId: input.dayId,
        kind: input.kind,
        status: input.status ?? "pending",
        sourceConversationIds: JSON.stringify(existing),
        connectionId: input.connectionId ?? null,
        model: input.model ?? null,
        replacementOfRunId: input.replacementOfRunId ?? null,
        startedAt: null,
        completedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await db.insert(characterDailyMemoryRuns).values(row);
      return mapRun(row as RunRow);
    },
    async updateRun(
      runId: string,
      patch: Partial<
        Pick<
          CharacterDailyMemoryRun,
          "status" | "connectionId" | "model" | "startedAt" | "completedAt" | "sourceConversationIds"
        >
      >,
      characterId?: string,
    ): Promise<CharacterDailyMemoryRun> {
      const current = await getRunOwned(runId, characterId);
      const row = {
        ...patch,
        ...(patch.sourceConversationIds ? { sourceConversationIds: JSON.stringify(patch.sourceConversationIds) } : {}),
        updatedAt: now(),
      } as Record<string, unknown>;
      delete row.sourceConversationIds;
      if (patch.sourceConversationIds) row.sourceConversationIds = JSON.stringify(patch.sourceConversationIds);
      await db.update(characterDailyMemoryRuns).set(row).where(eq(characterDailyMemoryRuns.id, runId));
      return mapRun({ ...current, ...row } as RunRow);
    },
    async setActiveRun(
      dayId: string,
      runId: string | null,
      status?: CharacterDailyMemoryDayStatus,
      characterId?: string,
    ): Promise<CharacterDailyMemoryDay> {
      const day = await getDayOwned(dayId, characterId);
      if (runId) await getRunOwned(runId, characterId);
      const patch = { activeRunId: runId, ...(status ? { status } : {}), updatedAt: now() };
      await db.update(characterDailyMemoryDays).set(patch).where(eq(characterDailyMemoryDays.id, dayId));
      return mapDay({ ...day, ...patch } as DayRow);
    },

    async listRunSources(runId: string, characterId?: string): Promise<CharacterDailyMemoryRunSource[]> {
      await getRunOwned(runId, characterId);
      const rows = await db
        .select()
        .from(characterDailyMemoryRunSources)
        .where(eq(characterDailyMemoryRunSources.runId, runId))
        .orderBy(asc(characterDailyMemoryRunSources.createdAt));
      return rows.map(mapSource);
    },
    async getRunSource(runSourceId: string, characterId?: string): Promise<CharacterDailyMemoryRunSource | null> {
      const row = await getSourceOwned(runSourceId, characterId).catch(() => null);
      return row ? mapSource(row) : null;
    },
    async createRunSource(input: CreateRunSourceInput, characterId?: string): Promise<CharacterDailyMemoryRunSource> {
      await getRunOwned(input.runId, characterId);
      const existing = await db
        .select()
        .from(characterDailyMemoryRunSources)
        .where(
          and(
            eq(characterDailyMemoryRunSources.runId, input.runId),
            eq(characterDailyMemoryRunSources.sourceConversationId, input.sourceConversationId),
          ),
        );
      if (existing[0]) return mapSource(existing[0]);
      const timestamp = now();
      const row = {
        id: newId(),
        runId: input.runId,
        sourceConversationId: input.sourceConversationId,
        sourceConversationName: input.sourceConversationName ?? "",
        status: "pending",
        attempts: 0,
        lastError: null,
        nextRetryAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await db.insert(characterDailyMemoryRunSources).values(row);
      return mapSource(row as SourceRow);
    },
    async updateRunSource(
      runSourceId: string,
      patch: Partial<
        Pick<
          CharacterDailyMemoryRunSource,
          "status" | "attempts" | "lastError" | "nextRetryAt" | "sourceConversationName"
        >
      >,
      characterId?: string,
    ): Promise<CharacterDailyMemoryRunSource> {
      const current = await getSourceOwned(runSourceId, characterId);
      const row = { ...patch, updatedAt: now() };
      await db
        .update(characterDailyMemoryRunSources)
        .set(row)
        .where(eq(characterDailyMemoryRunSources.id, runSourceId));
      return mapSource({ ...current, ...row } as SourceRow);
    },

    async listMemories(
      characterId: string,
      options: { dayId?: string; runId?: string; activeOnly?: boolean } = {},
    ): Promise<CharacterDailyMemory[]> {
      const days = options.activeOnly
        ? (
            await db
              .select({ id: characterDailyMemoryDays.id, activeRunId: characterDailyMemoryDays.activeRunId })
              .from(characterDailyMemoryDays)
              .where(eq(characterDailyMemoryDays.characterId, characterId))
          ).filter((day) => !!day.activeRunId)
        : [];
      const runIds = days.map((day) => day.activeRunId!).filter(Boolean);
      const conditions = [
        eq(characterDailyMemories.characterId, characterId),
        options.dayId ? eq(characterDailyMemories.dayId, options.dayId) : undefined,
        options.runId ? eq(characterDailyMemories.runId, options.runId) : undefined,
        options.activeOnly ? inArray(characterDailyMemories.runId, runIds) : undefined,
      ];
      if (options.activeOnly && runIds.length === 0) return [];
      const rows = await db
        .select()
        .from(characterDailyMemories)
        .where(and(...conditions))
        .orderBy(asc(characterDailyMemories.createdAt));
      return rows.map(mapMemory);
    },
    async createMemory(input: CreateMemoryInput, characterId?: string): Promise<CharacterDailyMemory> {
      if (characterId && characterId !== input.characterId) throw new Error("Daily memory character scope mismatch");
      await getDayOwned(input.dayId, input.characterId);
      await getRunOwned(input.runId, input.characterId);
      if (input.runSourceId) await getSourceOwned(input.runSourceId, input.characterId);
      const text = input.text.trim();
      if (!text) throw new Error("Daily memory text cannot be empty");
      if (!Number.isInteger(input.importance) || input.importance < 1 || input.importance > 5)
        throw new Error("Daily memory importance must be an integer from 1 to 5");
      const timestamp = now();
      const row = {
        id: newId(),
        characterId: input.characterId,
        dayId: input.dayId,
        runId: input.runId,
        runSourceId: input.runSourceId ?? null,
        origin: input.origin,
        sourceConversationId: input.sourceConversationId ?? null,
        sourceConversationName: input.sourceConversationName ?? null,
        text,
        importance: input.importance,
        embedding: input.embedding?.length ? JSON.stringify(input.embedding) : null,
        embeddingSpaceId: input.embedding?.length ? (input.embeddingSpaceId ?? null) : null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await db.insert(characterDailyMemories).values(row);
      return mapMemory(row as MemoryRow);
    },
    async updateMemory(
      memoryId: string,
      patch: { text?: string; importance?: number; embedding?: number[] | null; embeddingSpaceId?: string | null },
      characterId: string,
    ): Promise<CharacterDailyMemory> {
      const rows = await db
        .select()
        .from(characterDailyMemories)
        .where(and(eq(characterDailyMemories.id, memoryId), eq(characterDailyMemories.characterId, characterId)));
      const current = rows[0];
      if (!current) throw new Error("Daily memory was not found");
      if (patch.text !== undefined && !patch.text.trim()) throw new Error("Daily memory text cannot be empty");
      if (
        patch.importance !== undefined &&
        (!Number.isInteger(patch.importance) || patch.importance < 1 || patch.importance > 5)
      )
        throw new Error("Daily memory importance must be an integer from 1 to 5");
      const row = {
        ...(patch.text !== undefined ? { text: patch.text.trim() } : {}),
        ...(patch.importance !== undefined ? { importance: patch.importance } : {}),
        ...(patch.embedding !== undefined
          ? {
              embedding: patch.embedding?.length ? JSON.stringify(patch.embedding) : null,
              embeddingSpaceId: patch.embedding?.length ? (patch.embeddingSpaceId ?? null) : null,
            }
          : patch.text !== undefined
            ? { embedding: null, embeddingSpaceId: null }
            : {}),
        updatedAt: now(),
      };
      await db.update(characterDailyMemories).set(row).where(eq(characterDailyMemories.id, memoryId));
      return mapMemory({ ...current, ...row } as MemoryRow);
    },
    async deleteMemory(memoryId: string, characterId: string): Promise<void> {
      await db
        .delete(characterDailyMemories)
        .where(and(eq(characterDailyMemories.id, memoryId), eq(characterDailyMemories.characterId, characterId)));
    },
    async deleteRun(runId: string, characterId?: string): Promise<void> {
      await db.transaction(async (tx) => {
        await getRunOwned(runId, characterId);
        await tx.delete(characterDailyMemories).where(eq(characterDailyMemories.runId, runId));
        await tx.delete(characterDailyMemoryRunSources).where(eq(characterDailyMemoryRunSources.runId, runId));
        await tx.delete(characterDailyMemoryRuns).where(eq(characterDailyMemoryRuns.id, runId));
      });
    },
  };
}

export type CharacterDailyMemoriesStorage = ReturnType<typeof createCharacterDailyMemoriesStorage>;
