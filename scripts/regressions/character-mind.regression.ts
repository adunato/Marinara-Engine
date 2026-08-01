import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CharacterData } from "@marinara-engine/shared";
import type {
  BaseLLMProvider,
  ChatCompletionResult,
  ChatMessage,
  ChatOptions,
  LLMToolCall,
} from "../../packages/server/src/services/llm/base-provider.js";
import {
  initializeMind,
  revisionForPayload,
  snapshotAutoSummary,
  snapshotCharacterCard,
  snapshotDailyMemories,
  stableJson,
  verifyRawMarkdown,
} from "../../packages/server/src/services/character-mind/character-mind.files.js";
import {
  appendMindLog,
  hasSuccessfulBuild,
  parseMindLog,
  successfulIngestRevisions,
} from "../../packages/server/src/services/character-mind/character-mind.log.js";
import {
  runCharacterMindOperation,
  validateCharacterMindPlanResult,
} from "../../packages/server/src/services/character-mind/character-mind.runtime.js";
import {
  createCharacterMindTools,
  createCharacterMindTrace,
  deterministicMindFindings,
} from "../../packages/server/src/services/character-mind/character-mind.tools.js";
import { characterMindPrompt } from "../../packages/server/src/services/character-mind/character-mind.constants.js";

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

    const autoSummary = await snapshotAutoSummary(root, {
      chatId: "chat-1",
      period: "day",
      date: "30.07.2026",
      summary: "Mira and Alex planned to see Interstellar, but Alex did not arrive.",
      keyDetails: ["Alex missed the screening."],
    });
    assert.match(autoSummary.path, /^raw\/auto-summaries\/day\/30.07.2026--[0-9a-f]{16}\.md$/);
    assert.equal(
      (
        await snapshotAutoSummary(root, {
          chatId: "chat-1",
          period: "day",
          date: "30.07.2026",
          summary: "Mira and Alex planned to see Interstellar, but Alex did not arrive.",
          keyDetails: ["Alex missed the screening."],
        })
      ).created,
      false,
    );

    const planTrace = createCharacterMindTrace();
    const planTools = createCharacterMindTools(root, "plan", planTrace);
    await planTools.execute({
      id: "read-corpus",
      type: "function",
      function: {
        name: "mind_read_markdown",
        arguments: JSON.stringify({
          reads: [{ path: "SCHEMA.md" }, { path: "index.md" }, { path: day.path }, { path: autoSummary.path }],
        }),
      },
    });
    const plan = validateCharacterMindPlanResult(
      {
        summary: "Mapped the corpus.",
        pages: [
          {
            path: "wiki/relationship-with-alex.md",
            title: "Relationship with Alex",
            purpose: "Tracks the relationship and recurring disappointments.",
            sources: [day.path, autoSummary.path],
          },
        ],
        excludedSources: [],
      },
      planTrace,
      [day.path, autoSummary.path],
    );
    assert.equal(plan.pages.length, 1);
    assert.throws(
      () =>
        validateCharacterMindPlanResult(
          {
            summary: "Incomplete map.",
            pages: [
              {
                path: "wiki/relationship-with-alex.md",
                title: "Relationship with Alex",
                purpose: "Relationship evidence.",
                sources: [day.path],
              },
            ],
            excludedSources: [],
          },
          planTrace,
          [day.path, autoSummary.path],
        ),
      /did not account for sources/,
    );

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
    await queryTools.execute({
      id: "single-read",
      type: "function",
      function: { name: "mind_read_markdown", arguments: JSON.stringify({ path: "index.md" }) },
    });
    assert.equal(queryTrace.read.has("index.md"), true);
    await assert.rejects(
      queryTools.execute({
        id: "forbidden",
        type: "function",
        function: { name: "mind_write_index", arguments: JSON.stringify({ content: "# No" }) },
      }),
      /not permitted/,
    );

    const ingestPrompt = characterMindPrompt("ingest", day.path);
    assert.match(ingestPrompt, /mind_write_wiki\(\{"files":\[\.\.\.\]\}\)/);
    assert.match(ingestPrompt, /mind_write_index\(\{"content":"\.\.\."\}\)/);
    assert.match(ingestPrompt, /\{"summary":"concise description of what was integrated"\}/);
    assert.doesNotMatch(ingestPrompt, /required ingest JSON/);
    assert.match(characterMindPrompt("plan", JSON.stringify([day.path])), /Assess the complete corpus/);
    assert.match(characterMindPrompt("plan", JSON.stringify([day.path])), /at most 12 files per call/);
    assert.match(
      characterMindPrompt("build-page", JSON.stringify({ targetPage: plan.pages[0], pageMap: plan.pages })),
      /materialize one page/,
    );
    assert.match(
      characterMindPrompt("build-page", JSON.stringify({ targetPage: plan.pages[0], pageMap: plan.pages })),
      /Do not write\s+index\.md/,
    );

    const toolResponse = (toolCalls: LLMToolCall[]): ChatCompletionResult => ({
      content: "",
      toolCalls,
      finishReason: "tool_calls",
    });
    const finalResponse = (content: Record<string, unknown>): ChatCompletionResult => ({
      content: JSON.stringify(content),
      toolCalls: [],
      finishReason: "stop",
    });
    let plannerCall = 0;
    const recoveringProvider = {
      chatComplete: async (messages: ChatMessage[], _options: ChatOptions): Promise<ChatCompletionResult> => {
        plannerCall += 1;
        if (plannerCall === 1) {
          return toolResponse([
            {
              id: "initial-partial-read",
              type: "function",
              function: {
                name: "mind_read_markdown",
                arguments: JSON.stringify({
                  reads: [{ path: "SCHEMA.md" }, { path: "index.md" }, { path: day.path }],
                }),
              },
            },
          ]);
        }
        if (plannerCall === 2) {
          return finalResponse({
            summary: "Premature plan.",
            pages: [
              {
                path: "wiki/relationship-with-alex.md",
                title: "Relationship with Alex",
                purpose: "Relationship evidence.",
                sources: [day.path],
              },
            ],
            excludedSources: [],
          });
        }
        if (plannerCall === 3) {
          const correction = messages.at(-1);
          assert.equal(correction?.role, "user");
          assert.match(correction?.content ?? "", /PLAN VALIDATION REJECTED/);
          assert.match(correction?.content ?? "", new RegExp(autoSummary.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
          assert.match(correction?.content ?? "", /at most 12 files per call/);
          return toolResponse([
            {
              id: "corrective-read",
              type: "function",
              function: {
                name: "mind_read_markdown",
                arguments: JSON.stringify({ reads: [{ path: autoSummary.path }] }),
              },
            },
          ]);
        }
        return finalResponse({
          summary: "Mapped the complete corpus.",
          pages: [
            {
              path: "wiki/relationship-with-alex.md",
              title: "Relationship with Alex",
              purpose: "Tracks the relationship and recurring disappointments.",
              sources: [day.path, autoSummary.path],
            },
          ],
          excludedSources: [],
        });
      },
    } as unknown as BaseLLMProvider;
    const recoveredPlan = await runCharacterMindOperation({
      root,
      operation: "plan",
      value: JSON.stringify([day.path, autoSummary.path]),
      sourcePaths: [day.path, autoSummary.path],
      runtime: {
        provider: recoveringProvider,
        model: "regression-model",
        prompt: "",
        enableCaching: false,
        maxTokens: 4096,
      },
      signal: new AbortController().signal,
    });
    assert.equal(plannerCall, 4);
    assert.equal(
      "summary" in recoveredPlan.result ? recoveredPlan.result.summary : null,
      "Mapped the complete corpus.",
    );
    assert.equal(recoveredPlan.trace.verifiedRaw.has(autoSummary.path), true);

    const splitPlan = {
      summary: "Two-page map.",
      pages: [
        {
          path: "wiki/relationship-with-alex.md",
          title: "Relationship with Alex",
          purpose: "Tracks recurring disappointment.",
          sources: [day.path],
        },
        {
          path: "wiki/alex.md",
          title: "Alex",
          purpose: "Tracks concrete information about Alex.",
          sources: [autoSummary.path],
        },
      ],
      excludedSources: [],
    };
    const pageSessionCalls: number[] = [];
    const pageProvider = (pageIndex: number) => {
      let call = 0;
      const page = splitPlan.pages[pageIndex]!;
      return {
        chatComplete: async (messages: ChatMessage[], options: ChatOptions): Promise<ChatCompletionResult> => {
          call += 1;
          pageSessionCalls[pageIndex] = call;
          assert.equal(options.stream, true, "page sessions stream every completion");
          if (call === 1) {
            assert.equal(messages.length, 1, "each page starts with a fresh message history");
            assert.equal(
              options.tools?.some((tool) => tool.function.name === "mind_write_index"),
              false,
            );
            return toolResponse([
              {
                id: `read-page-${pageIndex}`,
                type: "function",
                function: {
                  name: "mind_read_markdown",
                  arguments: JSON.stringify({
                    reads: [{ path: "SCHEMA.md" }, { path: "index.md" }, { path: page.sources[0] }],
                  }),
                },
              },
            ]);
          }
          if (call === 2) {
            if (pageIndex === 0) return finalResponse({ summary: "Premature page result." });
            return toolResponse([
              {
                id: `write-page-${pageIndex}`,
                type: "function",
                function: {
                  name: "mind_write_wiki",
                  arguments: JSON.stringify({
                    files: [
                      {
                        path: page.path,
                        content: `# ${page.title}\n\nGrounded synthesis linking [[${splitPlan.pages[1 - pageIndex]!.path}]].\n\n## Sources\n\n- [[${page.sources[0]}]]\n`,
                      },
                    ],
                  }),
                },
              },
            ]);
          }
          if (call === 3 && pageIndex === 0) {
            const correction = messages.at(-1);
            assert.equal(correction?.role, "user");
            assert.match(correction?.content ?? "", /PAGE VALIDATION REJECTED/);
            assert.match(correction?.content ?? "", new RegExp(page.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
            return toolResponse([
              {
                id: `write-page-${pageIndex}`,
                type: "function",
                function: {
                  name: "mind_write_wiki",
                  arguments: JSON.stringify({
                    files: [
                      {
                        path: page.path,
                        content: `# ${page.title}\n\nGrounded synthesis linking [[${splitPlan.pages[1]!.path}]].\n\n## Sources\n\n- [[${page.sources[0]}]]\n`,
                      },
                    ],
                  }),
                },
              },
            ]);
          }
          return finalResponse({ summary: `Materialized ${page.path}.` });
        },
      } as unknown as BaseLLMProvider;
    };
    for (const [pageIndex, page] of splitPlan.pages.entries()) {
      const pageRun = await runCharacterMindOperation({
        root,
        operation: "build-page",
        value: JSON.stringify({ targetPage: page, pageMap: splitPlan.pages }),
        plan: splitPlan,
        page,
        runtime: {
          provider: pageProvider(pageIndex),
          model: "regression-model",
          prompt: "",
          enableCaching: false,
          maxTokens: 4096,
        },
        signal: new AbortController().signal,
      });
      assert.deepEqual(pageRun.result.created, []);
      assert.deepEqual(pageRun.result.updated, [page.path]);
    }
    assert.deepEqual(pageSessionCalls, [4, 3]);

    const restrictedPageTools = createCharacterMindTools(root, "build-page", createCharacterMindTrace(), {
      plannedWikiPaths: splitPlan.pages.map((page) => page.path),
      plannedSourcesByPage: Object.fromEntries(splitPlan.pages.map((page) => [page.path, page.sources])),
      writableWikiPaths: [splitPlan.pages[0]!.path],
    });
    await assert.rejects(
      restrictedPageTools.execute({
        id: "wrong-page",
        type: "function",
        function: {
          name: "mind_write_wiki",
          arguments: JSON.stringify({
            files: [{ path: splitPlan.pages[1]!.path, content: "# Wrong\n\n## Sources\n\n- [[raw/no.md]]\n" }],
          }),
        },
      }),
      /may not write wiki page/,
    );
    await assert.rejects(
      ingestTools.execute({
        id: "hallucinated-alias",
        type: "function",
        function: { name: "wiki_write", arguments: JSON.stringify({ writes: [] }) },
      }),
      /Use only these exact tool names:.*mind_write_wiki.*mind_write_index/,
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
    assert.equal(hasSuccessfulBuild(entries), false);
    await appendMindLog({
      root,
      operation: "build",
      subject: "1 mapped page",
      status: "success",
      revisions: [day.revision, autoSummary.revision],
      trace,
      summary: "Built.",
    });
    const builtEntries = parseMindLog(await readFile(join(root, "log.md"), "utf8"));
    assert.equal(hasSuccessfulBuild(builtEntries), true);
    assert.equal(successfulIngestRevisions(builtEntries).has(autoSummary.revision), true);

    const corruptedPath = join(root, ...first.path.split("/"));
    await writeFile(corruptedPath, (await readFile(corruptedPath, "utf8")).replace("Observant", "Corrupted"), "utf8");
    await assert.rejects(verifyRawMarkdown(root, first.path), /integrity check failed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await main();
console.log("Character Mind regression passed");
