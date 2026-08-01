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
  writeMindIndex,
} from "../../packages/server/src/services/character-mind/character-mind.files.js";
import {
  appendMindLog,
  hasSuccessfulBuild,
  parseMindLog,
  successfulBuildPagesSinceLatestMap,
  successfulIngestRevisions,
} from "../../packages/server/src/services/character-mind/character-mind.log.js";
import {
  characterMindPlanMatchesSources,
  pendingCharacterMindPages,
  parseCharacterMindPlan,
  renderCharacterMindPlan,
  validateCharacterMindChangePlan,
} from "../../packages/server/src/services/character-mind/character-mind.plan.js";
import {
  runCharacterMindOperation,
  validateCharacterMindPlanResult,
} from "../../packages/server/src/services/character-mind/character-mind.runtime.js";
import {
  createCharacterMindTools,
  createCharacterMindTrace,
  deterministicMindFindings,
  validateCompleteWiki,
  validateWikiPageCandidate,
} from "../../packages/server/src/services/character-mind/character-mind.tools.js";
import { characterMindPrompt } from "../../packages/server/src/services/character-mind/character-mind.constants.js";
import { CharacterMindCandidateSet } from "../../packages/server/src/services/character-mind/character-mind.candidate.js";

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
    const planMarkdown = renderCharacterMindPlan(plan);
    assert.deepEqual(parseCharacterMindPlan(planMarkdown), plan);
    assert.equal(characterMindPlanMatchesSources(plan, [day.path, autoSummary.path]), true);
    assert.equal(characterMindPlanMatchesSources(plan, [day.path]), false);
    assert.equal(parseCharacterMindPlan("# Index\n\nManually damaged"), null);
    assert.equal(
      parseCharacterMindPlan(
        "# Index\n\n## Corpus Summary\n\nSummary\n\n## Planned Pages\n\n### [[../bad.md|Bad]]\n\nBad path.\n\n#### Sources\n\n- [[raw/bad.md]]\n\n## Excluded Sources\n\nNone.\n",
      ),
      null,
    );
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
    const initialCandidates = await CharacterMindCandidateSet.create(root);
    await initialCandidates.requireAbsent("wiki/relationship-with-alex.md");
    await initialCandidates.requireAbsent("wiki/alex.md");
    await initialCandidates.write(
      "wiki/relationship-with-alex.md",
      `# Relationship with Alex\n\nMira feels let down by [[Alex]].\n\n## Sources\n\n- [[${day.path}]]\n`,
    );
    await initialCandidates.write(
      "wiki/alex.md",
      `# Alex\n\nAlex missed a planned screening.\n\n## Sources\n\n- [[${day.path}]]\n`,
    );
    await initialCandidates.write(
      "index.md",
      "# Index\n\n- [[relationship-with-alex]] — relationship synthesis\n- [[alex]] — person\n",
    );
    await validateCompleteWiki(root, initialCandidates);
    await initialCandidates.publish(trace);
    await initialCandidates.dispose();
    assert.deepEqual(await deterministicMindFindings(root), []);
    const discovered = await validateCharacterMindChangePlan(
      root,
      {
        summary: "The new evidence affects two existing subjects.",
        actions: [
          { type: "edit", path: "wiki/relationship-with-alex.md", sources: [day.path], reason: "Relationship" },
          { type: "edit", path: "wiki/alex.md", sources: [day.path], reason: "Person detail" },
        ],
      },
      trace,
      "ingest",
      day.path,
    );
    assert.equal(discovered.actions.length, 2, "ingest discovery may return an initially unknown multi-page set");
    await assert.rejects(
      validateCharacterMindChangePlan(
        root,
        {
          summary: "Incomplete retirement.",
          actions: [{ type: "delete", path: "wiki/alex.md", reason: "Duplicate" }],
        },
        trace,
        "ingest",
        day.path,
      ),
      /topology changes require an index-edit or index-replace action/,
    );

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
    assert.match(ingestPrompt, /read-only discovery session/);
    assert.match(ingestPrompt, /"type":"edit"/);
    assert.doesNotMatch(ingestPrompt, /mind_write_wiki|mind_write_index/);
    assert.match(characterMindPrompt("plan", JSON.stringify([day.path])), /Assess the complete corpus/);
    assert.match(characterMindPrompt("plan", JSON.stringify([day.path])), /at most 12 files per call/);
    assert.match(characterMindPrompt("plan", JSON.stringify([day.path])), /disjoint/);
    assert.match(characterMindPrompt("plan", JSON.stringify([day.path])), /account for every manifest source/);
    assert.match(
      characterMindPrompt("build-page", JSON.stringify({ targetPage: plan.pages[0], pageMap: plan.pages })),
      /materialize one page/,
    );
    assert.match(
      characterMindPrompt("build-page", JSON.stringify({ targetPage: plan.pages[0], pageMap: plan.pages })),
      /Do not write\s+index\.md/,
    );
    assert.match(
      characterMindPrompt("build-page", JSON.stringify({ targetPage: plan.pages[0], pageMap: plan.pages })),
      /complete page as\s+raw Markdown ordinary response text/,
    );
    assert.match(
      characterMindPrompt("build-page", JSON.stringify({ targetPage: plan.pages[0], pageMap: plan.pages })),
      /first non-empty line must be\s+exactly the mapped `# Title`/,
    );
    assert.match(
      characterMindPrompt("build-page", JSON.stringify({ targetPage: plan.pages[0], pageMap: plan.pages })),
      /exactly one unformatted, case-sensitive `## Sources` heading/,
    );
    assert.match(
      characterMindPrompt("build-page", JSON.stringify({ targetPage: plan.pages[0], pageMap: plan.pages })),
      /EXACT REQUIRED FIRST LINE:\s+# Relationship with Alex/,
    );
    assert.match(
      characterMindPrompt("build-page", JSON.stringify({ targetPage: plan.pages[0], pageMap: plan.pages })),
      new RegExp(`EXACT ALLOWED RAW-SOURCE WHITELIST:[\\s\\S]*${day.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
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
    const textResponse = (content: string): ChatCompletionResult => ({ content, toolCalls: [], finishReason: "stop" });
    let plannerCall = 0;
    const plannerSignals: AbortSignal[] = [];
    const plannerParentSignal = new AbortController().signal;
    const recoveringProvider = {
      chatComplete: async (messages: ChatMessage[], options: ChatOptions): Promise<ChatCompletionResult> => {
        plannerCall += 1;
        assert.ok(options.signal);
        plannerSignals.push(options.signal);
        if (plannerCall === 1) {
          assert.match(messages[0]?.content ?? "", /--- BEGIN SCHEMA\.md ---/);
          assert.match(messages[0]?.content ?? "", /--- BEGIN index\.md ---/);
          return toolResponse([
            {
              id: "initial-partial-read",
              type: "function",
              function: {
                name: "mind_read_markdown",
                arguments: JSON.stringify({
                  reads: [{ path: day.path }],
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
          assert.match(correction?.content ?? "", /VALIDATION REJECTED/);
          assert.match(correction?.content ?? "", new RegExp(autoSummary.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
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
      signal: plannerParentSignal,
    });
    assert.equal(plannerCall, 4);
    assert.equal(
      plannerSignals.every((signal) => signal !== plannerParentSignal),
      true,
    );
    assert.equal(new Set(plannerSignals).size, plannerSignals.length, "each provider turn gets a fresh timeout signal");
    assert.equal(
      "summary" in recoveredPlan.result ? recoveredPlan.result.summary : null,
      "Mapped the complete corpus.",
    );
    assert.equal(recoveredPlan.trace.verifiedRaw.has(autoSummary.path), true);

    let partitionCall = 0;
    const partitionProvider = {
      chatComplete: async (messages: ChatMessage[], options: ChatOptions): Promise<ChatCompletionResult> => {
        partitionCall += 1;
        if (partitionCall === 1) {
          return toolResponse([
            {
              id: "read-complete-corpus",
              type: "function",
              function: {
                name: "mind_read_markdown",
                arguments: JSON.stringify({
                  reads: [{ path: first.path }, { path: day.path }, { path: autoSummary.path }],
                }),
              },
            },
          ]);
        }
        if (partitionCall === 2) {
          return finalResponse({
            summary: "Invalid partition.",
            pages: [
              {
                path: "wiki/relationship-with-alex.md",
                title: "Relationship with Alex",
                purpose: "Relationship evidence.",
                sources: [first.path, day.path],
              },
            ],
            excludedSources: [
              { path: first.path, reason: "Incorrect overlap." },
              { path: day.path, reason: "Incorrect overlap." },
            ],
          });
        }
        assert.equal(options.tools, undefined, "partition-only correction cannot reread the corpus");
        const correction = messages.at(-1)?.content ?? "";
        assert.match(correction, /complete corpus is already read/i);
        assert.match(correction, /both assigned and excluded sources/);
        assert.match(correction, new RegExp(first.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        assert.match(correction, new RegExp(day.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        assert.match(correction, /did not account for sources/);
        assert.match(correction, new RegExp(autoSummary.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        return finalResponse({
          summary: "Corrected complete partition.",
          pages: [
            {
              path: "wiki/relationship-with-alex.md",
              title: "Relationship with Alex",
              purpose: "Relationship evidence.",
              sources: [first.path, day.path, autoSummary.path],
            },
          ],
          excludedSources: [],
        });
      },
    } as unknown as BaseLLMProvider;
    const partitionRun = await runCharacterMindOperation({
      root,
      operation: "plan",
      value: JSON.stringify([first.path, day.path, autoSummary.path]),
      sourcePaths: [first.path, day.path, autoSummary.path],
      runtime: {
        provider: partitionProvider,
        model: "regression-model",
        prompt: "",
        enableCaching: false,
        maxTokens: 4096,
      },
      signal: new AbortController().signal,
    });
    assert.equal(partitionCall, 3);
    assert.equal(partitionRun.diagnostics.validationAttempts, 2);
    assert.equal(partitionRun.diagnostics.validationFindings.length, 1);
    assert.match(partitionRun.diagnostics.validationFindings[0] ?? "", /^map-partition:/);

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
    await writeMindIndex(root, renderCharacterMindPlan(splitPlan));
    await validateCompleteWiki(root);
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
                    reads: [{ path: page.sources[0] }],
                  }),
                },
              },
            ]);
          }
          if (call === 2) {
            if (pageIndex === 0) return finalResponse({ summary: "Premature page result." });
            return textResponse(
              `# ${page.title}\n\nGrounded synthesis linking [[${splitPlan.pages[1 - pageIndex]!.path}]].\n\n## Sources\n\n- [[${page.sources[0]}]]\n`,
            );
          }
          if (call === 3 && pageIndex === 0) {
            const correction = messages.at(-1);
            assert.equal(correction?.role, "user");
            assert.match(correction?.content ?? "", /VALIDATION REJECTED/);
            return textResponse(
              `# ${page.title}\n\nGrounded synthesis linking [[${splitPlan.pages[1]!.path}]].\n\n## Sources\n\n- [[${page.sources[0]}]]\n`,
            );
          }
          throw new Error(`Unexpected page provider call ${call}`);
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
      assert.match("content" in pageRun.result ? pageRun.result.content : "", new RegExp(`^# ${page.title}`));
    }
    assert.deepEqual(pageSessionCalls, [3, 2]);

    const scopeTrace = createCharacterMindTrace();
    const scopedBuildTools = createCharacterMindTools(root, "build-page", scopeTrace, {
      allowedRawPaths: [day.path],
    });
    await assert.rejects(
      scopedBuildTools.execute({
        id: "outside-assignment-read",
        type: "function",
        function: { name: "mind_read_markdown", arguments: JSON.stringify({ path: autoSummary.path }) },
      }),
      /may not read unassigned raw source.*Remove or replace/,
    );
    assert.equal(scopeTrace.verifiedRaw.has(autoSummary.path), false);
    await assert.rejects(
      validateWikiPageCandidate(
        root,
        "wiki/relationship-with-alex.md",
        `# Relationship with Alex\n\nInline outside citation [[${autoSummary.path}]].\n\n## Sources\n\n- [[${day.path}]]\n`,
        {
          knownPaths: new Set(splitPlan.pages.map((page) => page.path)),
          requiredSources: new Set([day.path]),
          verifiedRaw: new Set([day.path]),
          expectedTitle: "Relationship with Alex",
        },
      ),
      /outside its frozen assignment.*Remove or replace.*do not read/,
    );

    const repairPage = splitPlan.pages[0]!;
    const repairCandidates = await CharacterMindCandidateSet.create(root);
    try {
      await repairCandidates.requireExisting(repairPage.path);
      let repairCall = 0;
      let completePageResponses = 0;
      const repairProvider = {
        chatComplete: async (messages: ChatMessage[], options: ChatOptions): Promise<ChatCompletionResult> => {
          repairCall += 1;
          assert.equal(options.stream, true);
          if (repairCall === 1) {
            return toolResponse([
              {
                id: "repair-read-source",
                type: "function",
                function: {
                  name: "mind_read_markdown",
                  arguments: JSON.stringify({ reads: [{ path: day.path }] }),
                },
              },
            ]);
          }
          if (repairCall === 2) {
            completePageResponses += 1;
            return textResponse(
              `Relationship with Alex\n======================\n\nGrounded synthesis.\n\n## **Sources**\n\n- [[${day.path}]]\n`,
            );
          }
          if (repairCall === 3) {
            assert.match(messages.at(-1)?.content ?? "", /retained.*unpublished temporary area/i);
            assert.match(messages.at(-1)?.content ?? "", /mind_edit_candidate/);
            return toolResponse([
              {
                id: "repair-setext-heading",
                type: "function",
                function: {
                  name: "mind_edit_candidate",
                  arguments: JSON.stringify({
                    path: repairPage.path,
                    oldText: "Relationship with Alex\n======================",
                    newText: "# Relationship with Alex",
                  }),
                },
              },
            ]);
          }
          if (repairCall === 4) return textResponse("Heading repaired.");
          if (repairCall === 5) {
            assert.match(messages.at(-1)?.content ?? "", /literal, unformatted ## Sources/);
            return toolResponse([
              {
                id: "repair-sources-heading",
                type: "function",
                function: {
                  name: "mind_edit_candidate",
                  arguments: JSON.stringify({
                    path: repairPage.path,
                    oldText: "## **Sources**",
                    newText: "## Sources",
                  }),
                },
              },
            ]);
          }
          if (repairCall === 6) return textResponse("Sources heading repaired.");
          throw new Error(`Unexpected repair provider call ${repairCall}`);
        },
      } as unknown as BaseLLMProvider;
      const repairedPage = await runCharacterMindOperation({
        root,
        operation: "build-page",
        value: JSON.stringify({
          targetPage: repairPage,
          pageMap: splitPlan.pages,
          allowedRawSources: repairPage.sources,
        }),
        plan: splitPlan,
        page: repairPage,
        candidate: repairCandidates,
        runtime: {
          provider: repairProvider,
          model: "regression-model",
          prompt: "",
          enableCaching: false,
          maxTokens: 4096,
        },
        signal: new AbortController().signal,
      });
      assert.equal(repairCall, 6);
      assert.equal(completePageResponses, 1, "local repairs do not stream another complete page");
      assert.equal(repairedPage.diagnostics.validationAttempts, 3);
      assert.deepEqual(
        repairedPage.diagnostics.validationFindings.map((finding) => finding.split(":", 1)[0]),
        ["page-format", "page-format"],
      );
      assert.match(
        "content" in repairedPage.result ? repairedPage.result.content : "",
        /^# Relationship with Alex[\s\S]*^## Sources$/m,
      );
    } finally {
      await repairCandidates.dispose();
    }

    const replacementPage = splitPlan.pages[1]!;
    const replacementCandidates = await CharacterMindCandidateSet.create(root);
    try {
      await replacementCandidates.requireExisting(replacementPage.path);
      let replacementCall = 0;
      const replacementProvider = {
        chatComplete: async (messages: ChatMessage[], options: ChatOptions): Promise<ChatCompletionResult> => {
          replacementCall += 1;
          if (replacementCall === 1) {
            return toolResponse([
              {
                id: "replacement-read-source",
                type: "function",
                function: {
                  name: "mind_read_markdown",
                  arguments: JSON.stringify({ reads: [{ path: autoSummary.path }] }),
                },
              },
            ]);
          }
          if (replacementCall === 2)
            return textResponse(
              `\`\`\`markdown\n# Alex\n\nInvalid fenced candidate.\n\n## Sources\n\n- [[${autoSummary.path}]]\n\`\`\``,
            );
          assert.equal(options.tools, undefined, "an explicit full replacement turn has no content-bearing tools");
          assert.match(messages.at(-1)?.content ?? "", /cannot be repaired safely.*complete replacement/is);
          return textResponse(`# Alex\n\nGrounded replacement.\n\n## Sources\n\n- [[${autoSummary.path}]]\n`);
        },
      } as unknown as BaseLLMProvider;
      const replacementRun = await runCharacterMindOperation({
        root,
        operation: "build-page",
        value: JSON.stringify({
          targetPage: replacementPage,
          pageMap: splitPlan.pages,
          allowedRawSources: replacementPage.sources,
        }),
        plan: splitPlan,
        page: replacementPage,
        candidate: replacementCandidates,
        runtime: {
          provider: replacementProvider,
          model: "regression-model",
          prompt: "",
          enableCaching: false,
          maxTokens: 4096,
        },
        signal: new AbortController().signal,
      });
      assert.equal(replacementCall, 3);
      assert.match("content" in replacementRun.result ? replacementRun.result.content : "", /^# Alex/);
    } finally {
      await replacementCandidates.dispose();
    }

    const checkpointEntries = parseMindLog(`# Log

## [2026-08-01T08:00:00.000Z] build-map | 2 current sources

- status: success
- read: none
- created: none
- updated: none

## [2026-08-01T08:01:00.000Z] build-page | wiki/relationship-with-alex.md

- status: success
- read: none
- created: none
- updated: none

## [2026-08-01T08:02:00.000Z] build-page | wiki/alex.md

- status: failure
- read: none
- created: none
- updated: none

## [2026-08-01T08:03:00.000Z] build-page | wiki/alex.md

- status: success
- read: none
- created: none
- updated: none
`);
    assert.deepEqual([...successfulBuildPagesSinceLatestMap(checkpointEntries)].sort(), [
      "wiki/alex.md",
      "wiki/relationship-with-alex.md",
    ]);
    assert.deepEqual(
      pendingCharacterMindPages(
        splitPlan,
        new Set(["wiki/relationship-with-alex.md", "wiki/alex.md"]),
        new Set(["wiki/relationship-with-alex.md"]),
      ).map((page) => page.path),
      ["wiki/alex.md"],
      "a successful log checkpoint is reusable only while its page still exists",
    );

    const editCandidates = await CharacterMindCandidateSet.create(root);
    await editCandidates.requireExisting("wiki/relationship-with-alex.md");
    const restrictedPageTools = createCharacterMindTools(root, "edit", createCharacterMindTrace(), {
      candidate: editCandidates,
      editablePaths: ["wiki/relationship-with-alex.md"],
    });
    await assert.rejects(
      restrictedPageTools.execute({
        id: "wrong-page",
        type: "function",
        function: {
          name: "mind_edit_candidate",
          arguments: JSON.stringify({ path: "wiki/alex.md", oldText: "Alex", newText: "Alexander" }),
        },
      }),
      /may not edit/,
    );
    await assert.rejects(
      restrictedPageTools.execute({
        id: "ambiguous-edit",
        type: "function",
        function: {
          name: "mind_edit_candidate",
          arguments: JSON.stringify({ path: "wiki/relationship-with-alex.md", oldText: "\n", newText: "\n\n" }),
        },
      }),
      /ambiguous/,
    );
    await restrictedPageTools.execute({
      id: "bounded-edit",
      type: "function",
      function: {
        name: "mind_edit_candidate",
        arguments: JSON.stringify({
          path: "wiki/relationship-with-alex.md",
          oldText: "Mira feels let down",
          newText: "Mira remains disappointed",
        }),
      },
    });
    assert.match(await editCandidates.read("wiki/relationship-with-alex.md"), /remains disappointed/);
    const manualContent = `# Relationship with Alex\n\nManual edit wins.\n\n## Sources\n\n- [[${day.path}]]\n`;
    await writeFile(join(root, "wiki", "relationship-with-alex.md"), manualContent, "utf8");
    await assert.rejects(editCandidates.publish(createCharacterMindTrace()), /publication conflict/);
    assert.equal(await readFile(join(root, "wiki", "relationship-with-alex.md"), "utf8"), manualContent);
    await editCandidates.dispose();

    await assert.rejects(
      ingestTools.execute({
        id: "complete-content-write",
        type: "function",
        function: { name: "mind_write_wiki", arguments: JSON.stringify({ files: [] }) },
      }),
      /not permitted/,
    );
    await assert.rejects(
      ingestTools.execute({
        id: "hallucinated-alias",
        type: "function",
        function: { name: "wiki_write", arguments: JSON.stringify({ writes: [] }) },
      }),
      /Use only these exact tool names: mind_list_markdown, mind_search_markdown, mind_read_markdown/,
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
    await appendMindLog({
      root,
      operation: "build-page",
      subject: "wiki/diagnostic-example.md",
      status: "failure",
      trace: createCharacterMindTrace(),
      validationAttempts: 3,
      validationFindings: ["page-format: expected exact heading", "page-source-scope: outside assignment"],
      providerError: "provider transport failed",
      error: "Page materialization failed",
    });
    const diagnosticLog = await readFile(join(root, "log.md"), "utf8");
    assert.match(diagnosticLog, /- validation-attempts: 3/);
    assert.match(diagnosticLog, /- validation-findings: page-format: expected exact heading \| page-source-scope:/);
    assert.match(diagnosticLog, /- provider-error: provider transport failed/);
    assert.match(diagnosticLog, /- error: Page materialization failed/);

    const corruptedPath = join(root, ...first.path.split("/"));
    await writeFile(corruptedPath, (await readFile(corruptedPath, "utf8")).replace("Observant", "Corrupted"), "utf8");
    await assert.rejects(verifyRawMarkdown(root, first.path), /integrity check failed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await main();
console.log("Character Mind regression passed");
