import type { CharacterBriefingPatch, CharacterBriefingState } from "@marinara-engine/shared";
import { and, eq } from "../../db/file-query.js";
import type { DB } from "../../db/connection.js";
import { characterBriefings } from "../../db/schema/index.js";
import { now } from "../../utils/id-generator.js";

type Row = typeof characterBriefings.$inferSelect;

function map(row: Row): CharacterBriefingState {
  return {
    characterId: row.characterId,
    sourceTemplate: row.sourceTemplate ?? "",
    generationConnectionId: row.generationConnectionId ?? null,
    latestBriefing: row.latestBriefing ?? null,
    latestGeneratedAt: row.latestGeneratedAt ?? null,
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
  };
}

export const emptyCharacterBriefing = (characterId: string): CharacterBriefingState => ({
  characterId,
  sourceTemplate: "",
  generationConnectionId: null,
  latestBriefing: null,
  latestGeneratedAt: null,
  createdAt: null,
  updatedAt: null,
});

export function createCharacterBriefingsStorage(db: DB) {
  return {
    async get(characterId: string): Promise<CharacterBriefingState> {
      const rows = await db.select().from(characterBriefings).where(eq(characterBriefings.characterId, characterId));
      return rows[0] ? map(rows[0]) : emptyCharacterBriefing(characterId);
    },
    async saveConfiguration(characterId: string, patch: CharacterBriefingPatch): Promise<CharacterBriefingState> {
      return db.transaction(async (tx) => {
        const rows = await tx.select().from(characterBriefings).where(eq(characterBriefings.characterId, characterId));
        const previous = rows[0];
        const timestamp = now();
        const values = {
          characterId,
          sourceTemplate: patch.sourceTemplate ?? previous?.sourceTemplate ?? "",
          generationConnectionId:
            patch.generationConnectionId !== undefined
              ? patch.generationConnectionId
              : (previous?.generationConnectionId ?? null),
          latestBriefing: previous?.latestBriefing ?? null,
          latestGeneratedAt: previous?.latestGeneratedAt ?? null,
          createdAt: previous?.createdAt ?? timestamp,
          updatedAt: timestamp,
        };
        if (previous)
          await tx.update(characterBriefings).set(values).where(eq(characterBriefings.characterId, characterId));
        else await tx.insert(characterBriefings).values(values);
        return map(values as Row);
      });
    },
    async publishLatest(
      characterId: string,
      expectedSourceTemplate: string,
      latestBriefing: string,
      generatedAt = now(),
    ): Promise<CharacterBriefingState> {
      return db.transaction(async (tx) => {
        const rows = await tx.select().from(characterBriefings).where(eq(characterBriefings.characterId, characterId));
        const current = rows[0];
        if (!current || current.sourceTemplate !== expectedSourceTemplate)
          throw new Error("Character Briefing source changed during generation");
        const values = { latestBriefing, latestGeneratedAt: generatedAt, updatedAt: now() };
        await tx
          .update(characterBriefings)
          .set(values)
          .where(
            and(
              eq(characterBriefings.characterId, characterId),
              eq(characterBriefings.sourceTemplate, expectedSourceTemplate),
            ),
          );
        return map({ ...current, ...values } as Row);
      });
    },
  };
}

export type CharacterBriefingsStorage = ReturnType<typeof createCharacterBriefingsStorage>;
