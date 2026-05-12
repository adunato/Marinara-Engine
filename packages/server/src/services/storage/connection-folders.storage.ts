// ──────────────────────────────────────────────
// Storage: API Connection Folders
// ──────────────────────────────────────────────
import { eq } from "drizzle-orm";
import type { DB } from "../../db/connection.js";
import { apiConnectionFolders, apiConnections } from "../../db/schema/index.js";
import { newId, now } from "../../utils/id-generator.js";

export function createConnectionFoldersStorage(db: DB) {
  return {
    async list() {
      return db.select().from(apiConnectionFolders).orderBy(apiConnectionFolders.sortOrder);
    },

    async getById(id: string) {
      const rows = await db.select().from(apiConnectionFolders).where(eq(apiConnectionFolders.id, id));
      return rows[0] ?? null;
    },

    async create(input: { name: string; color?: string }) {
      const id = newId();
      const timestamp = now();
      // Shift existing folders down and place new folder at the top.
      const existing = await db.select().from(apiConnectionFolders);
      for (const f of existing) {
        await db
          .update(apiConnectionFolders)
          .set({ sortOrder: f.sortOrder + 1 })
          .where(eq(apiConnectionFolders.id, f.id));
      }
      await db.insert(apiConnectionFolders).values({
        id,
        name: input.name,
        color: input.color ?? "",
        sortOrder: 0,
        collapsed: "false",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      return this.getById(id);
    },

    async update(id: string, data: Partial<{ name: string; color: string; sortOrder: number; collapsed: boolean }>) {
      await db
        .update(apiConnectionFolders)
        .set({
          ...(data.name !== undefined && { name: data.name }),
          ...(data.color !== undefined && { color: data.color }),
          ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
          ...(data.collapsed !== undefined && { collapsed: data.collapsed ? "true" : "false" }),
          updatedAt: now(),
        })
        .where(eq(apiConnectionFolders.id, id));
      return this.getById(id);
    },

    async remove(id: string) {
      // Unfile all connections in this folder (move back to root).
      await db.update(apiConnections).set({ folderId: null }).where(eq(apiConnections.folderId, id));
      await db.delete(apiConnectionFolders).where(eq(apiConnectionFolders.id, id));
    },

    async reorder(orderedIds: string[]) {
      for (let i = 0; i < orderedIds.length; i++) {
        await db
          .update(apiConnectionFolders)
          .set({ sortOrder: i, updatedAt: now() })
          .where(eq(apiConnectionFolders.id, orderedIds[i]!));
      }
    },

    async moveConnection(connectionId: string, folderId: string | null) {
      await db
        .update(apiConnections)
        .set({ folderId, updatedAt: now() })
        .where(eq(apiConnections.id, connectionId));
    },

    async reorderConnections(orderedIds: string[], folderId: string | null) {
      for (let i = 0; i < orderedIds.length; i++) {
        await db
          .update(apiConnections)
          .set({ sortOrder: i + 1, folderId, updatedAt: now() })
          .where(eq(apiConnections.id, orderedIds[i]!));
      }
    },
  };
}
