import type { FastifyInstance, FastifyReply } from "fastify";
import {
  buildCharacterMind,
  cancelCharacterMind,
  CharacterMindError,
  getCharacterMindStatus,
  lintCharacterMind,
  queryCharacterMind,
  queueCharacterMindSyncAfterDailyMemory,
  syncCharacterMind,
} from "../services/character-mind/character-mind.service.js";
import { CHARACTER_MIND_QUERY_MAX_CHARS } from "../services/character-mind/character-mind.constants.js";
import { onDailyMemoryDayReplaced } from "../services/conversation/daily-memory-events.js";
import { openFolderInFileManager } from "../lib/open-folder-in-file-manager.js";
import { requirePrivilegedAccess } from "../middleware/privileged-gate.js";

type Params = { chatId: string; characterId: string };

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof CharacterMindError) return reply.status(error.statusCode).send({ error: error.message });
  return reply.status(500).send({ error: "Character Mind operation failed; inspect log.md for details" });
}

export async function characterMindsRoutes(app: FastifyInstance) {
  const unsubscribe = onDailyMemoryDayReplaced((chatId) => queueCharacterMindSyncAfterDailyMemory(app.db, chatId));
  app.addHook("onClose", async () => unsubscribe());

  app.get<{ Params: Params }>("/:chatId/character-minds/:characterId/status", async (request, reply) => {
    try {
      return await getCharacterMindStatus(app.db, request.params.chatId, request.params.characterId);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post<{ Params: Params; Body: { restart?: boolean } }>(
    "/:chatId/character-minds/:characterId/build",
    async (request, reply) => {
      if (request.body?.restart !== undefined && typeof request.body.restart !== "boolean") {
        return reply.status(400).send({ error: "restart must be a boolean" });
      }
      try {
        return await buildCharacterMind(
          app.db,
          request.params.chatId,
          request.params.characterId,
          request.body?.restart === true,
        );
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  app.post<{ Params: Params; Body: { maxSources?: number } }>(
    "/:chatId/character-minds/:characterId/sync",
    async (request, reply) => {
      const value = request.body?.maxSources;
      if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 100)) {
        return reply.status(400).send({ error: "maxSources must be an integer from 1 to 100" });
      }
      try {
        return await syncCharacterMind(app.db, request.params.chatId, request.params.characterId, value);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  app.post<{ Params: Params; Body: { query?: string } }>(
    "/:chatId/character-minds/:characterId/query",
    async (request, reply) => {
      const query = typeof request.body?.query === "string" ? request.body.query.trim() : "";
      if (!query || query.length > CHARACTER_MIND_QUERY_MAX_CHARS) {
        return reply.status(400).send({ error: "query must contain 1 to 32768 characters" });
      }
      try {
        return await queryCharacterMind(app.db, request.params.chatId, request.params.characterId, query);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  app.post<{ Params: Params }>("/:chatId/character-minds/:characterId/lint", async (request, reply) => {
    try {
      return await lintCharacterMind(app.db, request.params.chatId, request.params.characterId);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post<{ Params: Params }>("/:chatId/character-minds/:characterId/open-folder", async (request, reply) => {
    if (!requirePrivilegedAccess(request, reply, { loopbackOnly: true, feature: "Character Mind folder opening" }))
      return;
    try {
      const status = await getCharacterMindStatus(app.db, request.params.chatId, request.params.characterId);
      if (!status.initialized || !status.path) {
        return reply.status(409).send({ error: "Character Mind is not initialized; use Build" });
      }
      await openFolderInFileManager(status.path);
      return { ok: true, path: status.path };
    } catch (error) {
      if (error instanceof CharacterMindError) return reply.status(error.statusCode).send({ error: error.message });
      request.log.warn(error, "Could not open Character Mind folder");
      return reply.status(500).send({ error: "Could not open Character Mind folder" });
    }
  });

  app.post<{ Params: Params }>("/:chatId/character-minds/:characterId/cancel", async (request, reply) => {
    try {
      await getCharacterMindStatus(app.db, request.params.chatId, request.params.characterId);
      return cancelCharacterMind(request.params.chatId, request.params.characterId);
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
