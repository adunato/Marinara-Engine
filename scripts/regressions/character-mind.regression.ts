import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CharacterData } from "@marinara-engine/shared";
import {
  initializeMind,
  revisionForPayload,
  snapshotCharacterCard,
  snapshotDailyMemories,
  stableJson,
  verifyRawMarkdown,
} from "../../packages/server/src/services/character-mind/character-mind.files.js";
import {
  appendMindLog,
  parseMindLog,
  successfulIngestRevisions,
} from "../../packages/server/src/services/character-mind/character-mind.log.js";
import {
  createCharacterMindTools,
  createCharacterMindTrace,
  deterministicMindFindings,
} from "../../packages/server/src/services/character-mind/character-mind.tools.js";

const root = join(process.cwd(), ".tmp-character-mind-regression");

async function main() {
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  try {
    assert.equal(stableJson({ z: 1, a: { y: 2, x: 3 } }), '{"a":{"x":3,"y":2},"z":1}');
    assert.equal(revisionForPayload({ b: 2, a: 1 }), revisionForPayload({ a: 1, b: 2 }));

    await initializeMind(root);
    const card = {
      characterId: "character-1",
      chatId: "chat-1",
      data: { name: "Mira", description: "Observant" } as CharacterData,
      conversationOverrides: { aboutMe: null },
    };
    const first = await snapshotCharacterCard(root, card);
    const duplicate = await snapshotCharacterCard(root, card);
    assert.equal(first.created, true);
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.path, first.path);
    assert.deepEqual(await verifyRawMarkdown(root, first.path), {
      revision: first.revision,
      sourceKey: "character-card:character-1:chat-1",
    });

    const second = await snapshotCharacterCard(root, { ...card, data: { ...card.data, description: "Patient" } });
    assert.notEqual(second.revision, first.revision);
    assert.match(
      await readFile(join(root, ...second.path.split("/")), "utf8"),
      new RegExp(`supersedes: ${first.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
    );

    const day = await snapshotDailyMemories(root, {
      chatId: "chat-1",
      date: "2026-07-30",
      memories: [
        {
          id: "memory-1",
          memory: "Alex missed the Interstellar screening.",
          importance: 4,
          createdAt: "2026-07-30T20:00:00.000Z",
          updatedAt: "2026-07-30T20:00:00.000Z",
        },
      ],
    });
    assert.match(day.path, /^raw\/daily-memories\/2026-07-30--[0-9a-f]{16}\.md$/);

    const trace = createCharacterMindTrace();
    const ingestTools = createCharacterMindTools(root, "ingest", trace);
    await ingestTools.execute({
      id: "read-source",
      type: "function",
      function: { name: "mind_read_markdown", arguments: JSON.stringify({ reads: [{ path: day.path }] }) },
    });
    await ingestTools.execute({
      id: "write-page",
      type: "function",
      function: {
        name: "mind_write_wiki",
        arguments: JSON.stringify({
          files: [
            {
              path: "wiki/relationship-with-alex.md",
              content: `# Relationship with Alex\n\nMira feels let down by [[Alex]].\n\n## Sources\n\n- [[${day.path}]]\n`,
            },
            {
              path: "wiki/alex.md",
              content: `# Alex\n\nAlex missed a planned screening.\n\n## Sources\n\n- [[${day.path}]]\n`,
            },
          ],
        }),
      },
    });
    await ingestTools.execute({
      id: "write-index",
      type: "function",
      function: {
        name: "mind_write_index",
        arguments: JSON.stringify({
          content: "# Index\n\n- [[relationship-with-alex]] — relationship synthesis\n- [[alex]] — person\n",
        }),
      },
    });
    assert.deepEqual(await deterministicMindFindings(root), []);

    const queryTrace = createCharacterMindTrace();
    const queryTools = createCharacterMindTools(root, "query", queryTrace);
    assert.equal(
      queryTools.tools.some((tool) => tool.function.name.startsWith("mind_write")),
      false,
    );
    await assert.rejects(
      queryTools.execute({
        id: "forbidden",
        type: "function",
        function: { name: "mind_write_index", arguments: JSON.stringify({ content: "# No" }) },
      }),
      /not permitted/,
    );

    await appendMindLog({
      root,
      operation: "ingest",
      subject: day.path,
      status: "success",
      revision: day.revision,
      trace,
      summary: "Integrated.",
    });
    const entries = parseMindLog(await readFile(join(root, "log.md"), "utf8"));
    assert.equal(entries.at(-1)?.revision, day.revision);
    assert.equal(successfulIngestRevisions(entries).has(day.revision), true);

    const corruptedPath = join(root, ...first.path.split("/"));
    await writeFile(corruptedPath, (await readFile(corruptedPath, "utf8")).replace("Observant", "Corrupted"), "utf8");
    await assert.rejects(verifyRawMarkdown(root, first.path), /integrity check failed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await main();
console.log("Character Mind regression passed");
