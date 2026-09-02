import type { CharacterDailyMemory } from "@marinara-engine/shared";
import type { DB } from "../../db/connection.js";
import { embedMemoryRecallTexts } from "../memory-recall.js";
import { resolveMemoryRecallEmbeddingSource } from "../memory-recall-embedding.js";
import type { CharacterDailyMemoriesStorage } from "../storage/character-daily-memories.storage.js";

export type CharacterDailyMemoryRetrievalResult = CharacterDailyMemory & {
  semanticScore: number;
  importanceScore: number;
  recencyScore: number;
  rankScore: number;
};

export type CharacterDailyMemoryRetrieval = {
  available: boolean;
  results: CharacterDailyMemoryRetrievalResult[];
};

const DEFAULT_LIMIT = 10;
const RECENCY_HALF_LIFE_DAYS = 30;

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let aMagnitude = 0;
  let bMagnitude = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    aMagnitude += a[i]! * a[i]!;
    bMagnitude += b[i]! * b[i]!;
  }
  const denominator = Math.sqrt(aMagnitude) * Math.sqrt(bMagnitude);
  return denominator > 0 ? Math.max(0, dot / denominator) : 0;
}

function normalizedWeights(settings: { semanticWeight: number; importanceWeight: number; recencyWeight: number }) {
  const semantic = Math.max(0, settings.semanticWeight);
  const importance = Math.max(0, settings.importanceWeight);
  const recency = Math.max(0, settings.recencyWeight);
  const total = semantic + importance + recency;
  return total > 0
    ? { semantic: semantic / total, importance: importance / total, recency: recency / total }
    : { semantic: 1, importance: 0, recency: 0 };
}

function parseEmbedding(value: number[] | null): number[] | null {
  return Array.isArray(value) && value.length > 0 && value.every((item) => Number.isFinite(item)) ? value : null;
}

export function rankCharacterDailyMemories(
  memories: CharacterDailyMemory[],
  queryEmbedding: number[],
  settings: { semanticWeight: number; importanceWeight: number; recencyWeight: number; minimumRankPercent: number },
  now = new Date(),
  limit = DEFAULT_LIMIT,
): CharacterDailyMemoryRetrievalResult[] {
  const weights = normalizedWeights(settings);
  const scored = memories
    .map((memory) => {
      const embedding = parseEmbedding(memory.embedding);
      if (!embedding || embedding.length !== queryEmbedding.length) return null;
      const semanticScore = cosineSimilarity(queryEmbedding, embedding);
      const importanceScore = Math.max(0, Math.min(1, memory.importance / 5));
      const ageDays = Math.max(0, (now.getTime() - new Date(memory.createdAt).getTime()) / 86_400_000);
      const recencyScore = Number.isFinite(ageDays) ? 2 ** (-ageDays / RECENCY_HALF_LIFE_DAYS) : 0;
      return {
        ...memory,
        semanticScore,
        importanceScore,
        recencyScore,
        rankScore:
          semanticScore * weights.semantic + importanceScore * weights.importance + recencyScore * weights.recency,
      };
    })
    .filter((memory): memory is CharacterDailyMemoryRetrievalResult => memory !== null)
    .sort((a, b) => b.rankScore - a.rankScore || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  const threshold = Math.max(0, Math.min(100, settings.minimumRankPercent)) / 100;
  const highest = scored[0]?.rankScore ?? 0;
  return scored.filter((memory) => highest === 0 || memory.rankScore >= highest * threshold).slice(0, limit);
}

export function createCharacterDailyMemoryRetrievalService(args: { db: DB; storage?: CharacterDailyMemoriesStorage }) {
  const storage = args.storage;
  return {
    async searchForCharacter(input: {
      characterId: string;
      query: string;
      signal?: AbortSignal;
    }): Promise<CharacterDailyMemoryRetrieval> {
      const query = input.query.trim();
      if (!query) return { available: true, results: [] };
      const settings = storage ? await storage.getSettings(input.characterId) : null;
      if (!settings) return { available: true, results: [] };
      const memories = storage ? await storage.listMemories(input.characterId, { activeOnly: true }) : [];
      if (memories.length === 0) return { available: true, results: [] };
      const source = await resolveMemoryRecallEmbeddingSource(args.db, {
        connectionId: settings.formationConnectionId,
      });
      const vectors = await embedMemoryRecallTexts([query], {
        embeddingSource: source,
        signal: input.signal,
        inputType: "query",
      });
      const queryEmbedding = vectors[0];
      if (!queryEmbedding?.length) return { available: false, results: [] };
      return { available: true, results: rankCharacterDailyMemories(memories, queryEmbedding, settings) };
    },
  };
}

export type CharacterDailyMemoryRetrievalService = ReturnType<typeof createCharacterDailyMemoryRetrievalService>;
