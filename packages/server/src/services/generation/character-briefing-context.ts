import type { AgentContext } from "@marinara-engine/shared";
import type { DB } from "../../db/connection.js";
import { createCharacterBriefingsStorage } from "../storage/character-briefings.storage.js";

export async function appendCharacterBriefingContext(
  db: DB,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  targets: Array<{ id: string; name: string }>,
): Promise<void> {
  const uniqueTargets = [...new Map(targets.map((target) => [target.id, target])).values()];
  if (uniqueTargets.length === 0) return;
  const storage = createCharacterBriefingsStorage(db);
  const blocks: string[] = [];
  for (const target of uniqueTargets) {
    try {
      const state = await storage.get(target.id);
      if (state.latestBriefing?.trim())
        blocks.push(`Character Briefing for ${target.name} (ID: ${target.id}):\n${state.latestBriefing.trim()}`);
    } catch {
      // Briefings are optional context and must not make ordinary generation fail.
    }
  }
  if (blocks.length === 0) return;
  messages.push({ role: "system", content: `<character_briefings>\n${blocks.join("\n\n")}\n</character_briefings>` });
}

export function characterBriefingTargets(
  context: AgentContext,
  targetIds: readonly string[],
): Array<{ id: string; name: string }> {
  const ids = new Set(targetIds);
  return context.characters.filter((character) => ids.has(character.id)).map(({ id, name }) => ({ id, name }));
}
