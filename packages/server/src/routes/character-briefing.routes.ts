import type { FastifyInstance } from "fastify";
import { characterBriefingPatchSchema } from "@marinara-engine/shared";
import { createCharactersStorage } from "../services/storage/characters.storage.js";
import { createConnectionsStorage } from "../services/storage/connections.storage.js";
import { createCharacterBriefingService } from "../services/character-briefing.service.js";

export async function characterBriefingRoutes(app: FastifyInstance) {
  const chars = createCharactersStorage(app.db);
  const connections = createConnectionsStorage(app.db);
  const service = createCharacterBriefingService({ db: app.db });

  async function exists(characterId: string) {
    return Boolean(await chars.getById(characterId));
  }

  app.get<{ Params: { characterId: string } }>("/:characterId/briefing", async (request, reply) => {
    if (!(await exists(request.params.characterId))) return reply.status(404).send({ error: "Character not found" });
    return service.storage.get(request.params.characterId);
  });

  app.patch<{ Params: { characterId: string } }>("/:characterId/briefing", async (request, reply) => {
    const characterId = request.params.characterId;
    if (!(await exists(characterId))) return reply.status(404).send({ error: "Character not found" });
    const patch = characterBriefingPatchSchema.parse(request.body);
    if (patch.generationConnectionId) {
      const connection = await connections.getWithKey(patch.generationConnectionId);
      if (!connection || ["image_generation", "video_generation", "audio"].includes(connection.provider)) {
        return reply.status(400).send({ error: "Character Briefing requires a usable language-model connection" });
      }
    }
    return service.storage.saveConfiguration(characterId, patch);
  });

  app.post<{ Params: { characterId: string } }>("/:characterId/briefing/generate", async (request, reply) => {
    if (!(await exists(request.params.characterId))) return reply.status(404).send({ error: "Character not found" });
    try {
      return await service.generate(request.params.characterId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Character Briefing generation failed";
      if (message.includes("already in progress")) return reply.status(409).send({ error: message });
      if (message.includes("source changed")) return reply.status(409).send({ error: message });
      return reply.status(400).send({ error: message });
    }
  });
}
