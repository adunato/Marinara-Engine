import {
  folderIdParamsSchema,
  reorderFoldersSchema,
  updateFolderSchema,
  type UpdateFolderInput,
} from "@marinara-engine/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ZodType } from "zod";
import { logger } from "../lib/logger.js";

type StoredFolder = {
  collapsed: string;
};

type FolderCrudStorage<TCreate, TFolder extends StoredFolder> = {
  list(profileId?: string): Promise<TFolder[]>;
  getById(id: string): Promise<TFolder | null>;
  create(input: TCreate): Promise<TFolder | null>;
  update(id: string, input: UpdateFolderInput): Promise<TFolder | null>;
  remove(id: string): Promise<void>;
  reorder(orderedIds: string[]): Promise<void>;
};

type FolderRouteScope<TCreate, TFolder extends StoredFolder> = {
  resolveProfileId(req: FastifyRequest, reply: FastifyReply): Promise<string | null>;
  validateCreate(input: TCreate, profileId: string, reply: FastifyReply): Promise<boolean>;
  ownsFolder(folder: TFolder, profileId: string): boolean;
};

function serializeFolder<TFolder extends StoredFolder>(folder: TFolder) {
  return {
    ...folder,
    collapsed: folder.collapsed === "true",
  };
}

export function registerFolderCrudRoutes<TCreate, TFolder extends StoredFolder>(
  app: FastifyInstance,
  createSchema: ZodType<TCreate>,
  storage: FolderCrudStorage<TCreate, TFolder>,
  scope?: FolderRouteScope<TCreate, TFolder>,
) {
  const resolveScope = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!scope) return null;
    return scope.resolveProfileId(req, reply);
  };

  app.get("/", async (req, reply) => {
    const profileId = await resolveScope(req, reply);
    if (scope && !profileId) return;
    const folders = profileId ? await storage.list(profileId) : await storage.list();
    return reply.send(folders.map(serializeFolder));
  });

  app.post("/", async (req, reply) => {
    const profileId = await resolveScope(req, reply);
    if (scope && !profileId) return;
    const input = createSchema.parse(req.body);
    if (scope && !(await scope.validateCreate(input, profileId!, reply))) return;
    const folder = await storage.create(input);
    if (!folder) {
      logger.error("Folder storage.create returned no folder");
      return reply.status(500).send({ error: "Failed to create folder" });
    }
    return reply.send(serializeFolder(folder));
  });

  app.patch("/:id", async (req, reply) => {
    const profileId = await resolveScope(req, reply);
    if (scope && !profileId) return;
    const { id } = folderIdParamsSchema.parse(req.params);
    const input = updateFolderSchema.parse(req.body);
    const existing = await storage.getById(id);
    if (!existing) return reply.status(404).send({ error: "Folder not found" });
    if (scope && !scope.ownsFolder(existing, profileId!)) return reply.status(404).send({ error: "Folder not found" });
    const folder = await storage.update(id, input);
    if (!folder) {
      logger.error("Folder storage.update returned no folder for %s", id);
      return reply.status(500).send({ error: "Failed to update folder" });
    }
    return reply.send(serializeFolder(folder));
  });

  app.delete("/:id", async (req, reply) => {
    const profileId = await resolveScope(req, reply);
    if (scope && !profileId) return;
    const { id } = folderIdParamsSchema.parse(req.params);
    const existing = await storage.getById(id);
    if (!existing) return reply.status(404).send({ error: "Folder not found" });
    if (scope && !scope.ownsFolder(existing, profileId!)) return reply.status(404).send({ error: "Folder not found" });
    await storage.remove(id);
    return reply.send({ ok: true });
  });

  app.post("/reorder", async (req, reply) => {
    const profileId = await resolveScope(req, reply);
    if (scope && !profileId) return;
    const { orderedIds } = scope
      ? reorderFoldersSchema.parse(req.body)
      : reorderFoldersSchema.omit({ profileId: true }).parse(req.body);
    if (scope) {
      const folders = await Promise.all(orderedIds.map((id) => storage.getById(id)));
      if (folders.some((folder) => !folder || !scope.ownsFolder(folder, profileId!))) {
        return reply.status(404).send({ error: "Folder not found" });
      }
    }
    await storage.reorder(orderedIds);
    return reply.send({ ok: true });
  });
}
