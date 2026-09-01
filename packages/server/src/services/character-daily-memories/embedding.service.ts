import type { CharacterDailyMemory } from "@marinara-engine/shared";
import { DEFAULT_LOCAL_MEMORY_EMBEDDING_SPACE_ID, embedMemoryRecallTexts } from "../memory-recall.js";
import { resolveMemoryRecallEmbeddingSource } from "../memory-recall-embedding.js";
import type { DB } from "../../db/connection.js";
import type { CharacterDailyMemoriesStorage } from "../storage/character-daily-memories.storage.js";

export type CharacterDailyMemoryEmbeddingResult = { embedding: number[]; embeddingSpaceId: string } | null;

/**
 * Embed one Daily Memory using the formation connection's configured embedding
 * source. The existing local model is deliberately the fallback when that
 * connection has no embedding configuration.
 */
export async function embedCharacterDailyMemoryText(
  db: DB,
  text: string,
  connectionId?: string | null,
  signal?: AbortSignal,
): Promise<CharacterDailyMemoryEmbeddingResult> {
  try {
    const source = await resolveMemoryRecallEmbeddingSource(db, { connectionId: connectionId ?? null });
    const vectors = await embedMemoryRecallTexts([text], { embeddingSource: source, signal, inputType: "document" });
    const embedding = vectors[0];
    if (!Array.isArray(embedding) || embedding.length === 0) return null;
    const embeddingSpaceId = source?.spaceId?.trim() || (source ? null : DEFAULT_LOCAL_MEMORY_EMBEDDING_SPACE_ID);
    return embeddingSpaceId ? { embedding, embeddingSpaceId } : null;
  } catch {
    // Vectorization is best effort. Formation text remains durable and the
    // caller must persist a null vector rather than failing the source.
    return null;
  }
}

export async function createCharacterDailyMemoryEmbeddingService(args: {
  db: DB;
  storage: CharacterDailyMemoriesStorage;
}) {
  return {
    embedText: (text: string, connectionId?: string | null, signal?: AbortSignal) =>
      embedCharacterDailyMemoryText(args.db, text, connectionId, signal),
    async revectorizeCharacter(characterId: string, connectionId?: string | null): Promise<number> {
      const memories = await args.storage.listMemories(characterId, { activeOnly: true });
      let updated = 0;
      for (const memory of memories) {
        const result = await embedCharacterDailyMemoryText(args.db, memory.text, connectionId);
        if (result) {
          await args.storage.updateMemory(memory.id, result, characterId);
          updated += 1;
        }
      }
      return updated;
    },
  };
}

export type CharacterDailyMemoryEmbeddingService = Awaited<
  ReturnType<typeof createCharacterDailyMemoryEmbeddingService>
>;

export function embeddingPatch(
  result: CharacterDailyMemoryEmbeddingResult,
): Pick<CharacterDailyMemory, "embedding" | "embeddingSpaceId"> {
  return result ? result : { embedding: null, embeddingSpaceId: null };
}
