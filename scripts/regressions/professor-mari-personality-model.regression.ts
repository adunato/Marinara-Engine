import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CHARACTER_PERSONALITY_MODEL_ID,
  compileCharacterPersonalityModel,
} from "../../packages/shared/src/utils/character-personality-model.js";

const previousFileStorageDir = process.env.FILE_STORAGE_DIR;
const previousDataDir = process.env.DATA_DIR;
const root = mkdtempSync(join(tmpdir(), "marinara-personality-model-regression-"));
process.env.FILE_STORAGE_DIR = join(root, "file-storage");
process.env.DATA_DIR = join(root, "data");

type Row = Record<string, unknown>;

function asRow(value: unknown): Row {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Row;
}

function asApprovalId(value: unknown): string {
  const row = asRow(value);
  assert.equal(row.status, "pending");
  assert.equal(typeof row.id, "string");
  return row.id as string;
}

const selection = {
  modelId: CHARACTER_PERSONALITY_MODEL_ID,
  enneagramType: "6",
  attachmentStyle: "dismissive-avoidant",
} as const;
const alternateSelection = {
  enneagramType: "9",
  attachmentStyle: "secure",
} as const;
const compiled = compileCharacterPersonalityModel(selection);
const alternateCompiled = compileCharacterPersonalityModel(alternateSelection);

try {
  const [{ createFileNativeDB }, { MariDbService }, { ProfessorMariWorkspaceSkillsService }] = await Promise.all([
    import("../../packages/server/src/db/file-backed-store.js"),
    import("../../packages/server/src/services/mari-db/mari-db.service.js"),
    import("../../packages/server/src/services/professor-mari/workspace-skills.service.js"),
  ]);

  const db = await createFileNativeDB();
  const mari = new MariDbService(db);

  const keepReview = async (result: Row) => {
    const approvalId = asApprovalId(result.approval);
    const kept = await mari.keepAppliedReview(approvalId);
    assert.ok(kept, `expected review ${approvalId} to be keepable`);
  };

  const getCharacter = async (id: string) => {
    const result = await mari.executeAction({ action: "character.get", characterId: id });
    assert.equal(result.ok, true, `expected character ${id} to exist`);
    return asRow(result.output);
  };

  // Ordinary create remains unchanged when no personalityModel is supplied.
  const ordinaryCreate = asRow(
    await mari.executeAction({
      action: "character.create",
      characterId: "ordinary-character",
      data: {
        name: "Ordinary Character",
        personality: "Manual personality text",
        extensions: { customMarker: "ordinary", emotionProfile: { legacy: true } },
      },
      apply: true,
    }),
  );
  assert.equal(ordinaryCreate.ok, true);
  await keepReview(ordinaryCreate);
  const ordinaryRow = await getCharacter("ordinary-character");
  const ordinaryData = asRow(ordinaryRow.data);
  assert.equal(ordinaryData.personality, "Manual personality text");
  assert.deepEqual(asRow(ordinaryData.extensions).emotionProfile, { legacy: true });

  // Model-backed create owns both generated fields and wins over conflicting raw values.
  const modelCreate = asRow(
    await mari.executeAction({
      action: "character.create",
      characterId: "model-character",
      data: {
        name: "Model Character",
        description: "Keep this description",
        personality: "This must be replaced",
        extensions: {
          customMarker: "preserve-me",
          emotionProfile: { enabled: false, defaultStateId: "legacy", states: [] },
        },
      },
      personalityModel: selection,
      apply: true,
      reason: "Regression: create with canonical personality model",
    }),
  );
  assert.equal(modelCreate.ok, true);
  await keepReview(modelCreate);
  const modelRow = await getCharacter("model-character");
  const modelData = asRow(modelRow.data);
  const modelExtensions = asRow(modelData.extensions);
  assert.equal(modelData.personality, compiled.personality);
  assert.deepEqual(modelExtensions.emotionProfile, compiled.emotionProfile);
  assert.equal(modelExtensions.customMarker, "preserve-me");
  assert.equal(modelData.description, "Keep this description");
  assert.equal("personalityModel" in modelData, false);
  assert.equal("modelId" in modelData, false);
  assert.equal("enneagramType" in modelData, false);
  assert.equal("attachmentStyle" in modelData, false);

  const invalidCreate = asRow(
    await mari.executeAction({
      action: "character.create",
      characterId: "invalid-model-character",
      data: { name: "Invalid Model Character" },
      personalityModel: { enneagramType: "0", attachmentStyle: "secure" },
      apply: true,
    }),
  );
  assert.equal(invalidCreate.ok, false);
  const invalidLookup = asRow(
    await mari.executeAction({ action: "character.get", characterId: "invalid-model-character" }),
  );
  assert.equal(invalidLookup.ok, false, "invalid selection must not partially create a character");

  // Build an existing character with unrelated card data + row metadata to protect during reapplication.
  const existingCreate = asRow(
    await mari.executeAction({
      action: "character.create",
      characterId: "existing-character",
      data: {
        name: "Existing Character",
        description: "Preserved description",
        personality: "Original personality",
        scenario: "Preserved scenario",
        tags: ["one", "two"],
        extensions: {
          customMarker: { nested: "keep" },
          emotionProfile: {
            enabled: true,
            defaultStateId: "legacy",
            states: [{ id: "legacy", label: "Legacy", description: "Legacy classifier" }],
          },
        },
      },
      comment: "Preserved comment",
      apply: true,
    }),
  );
  assert.equal(existingCreate.ok, true);
  await keepReview(existingCreate);

  const metadataPatch = asRow(
    await mari.executeCli({
      argv: [
        "db",
        "patch",
        "characters",
        "existing-character",
        "--json",
        JSON.stringify({ avatarPath: "avatars/existing.png", spriteFolderPath: "sprites/existing" }),
        "--apply",
      ],
      sessionId: "personality-model-regression",
    }),
  );
  assert.equal(metadataPatch.ok, true);
  await keepReview(metadataPatch);

  const beforeApply = await getCharacter("existing-character");

  const dryRun = asRow(
    await mari.executeAction({
      action: "character.applyPersonalityModel",
      characterId: "existing-character",
      personalityModel: alternateSelection,
      apply: false,
      reason: "Regression: dry-run personality model reapplication",
    }),
  );
  assert.equal(dryRun.ok, true);
  assert.equal(dryRun.mode, "dry-run");
  assert.deepEqual(await getCharacter("existing-character"), beforeApply, "dry-run must not persist any card change");

  const applied = asRow(
    await mari.executeAction({
      action: "character.applyPersonalityModel",
      characterId: "existing-character",
      personalityModel: alternateSelection,
      apply: true,
      reason: "Regression: reapply canonical personality model",
    }),
  );
  assert.equal(applied.ok, true);
  assert.equal(applied.mode, "apply");
  const applyReviewId = asApprovalId(applied.approval);

  const afterApply = await getCharacter("existing-character");
  const afterData = asRow(afterApply.data);
  const beforeData = asRow(beforeApply.data);
  const afterExtensions = asRow(afterData.extensions);
  const beforeExtensions = asRow(beforeData.extensions);
  assert.equal(afterData.personality, alternateCompiled.personality);
  assert.deepEqual(afterExtensions.emotionProfile, alternateCompiled.emotionProfile);
  assert.equal("legacy" in asRow(afterExtensions.emotionProfile), false, "emotionProfile is replaced as a whole object");
  assert.deepEqual(afterExtensions.customMarker, beforeExtensions.customMarker);
  assert.equal(afterData.description, beforeData.description);
  assert.equal(afterData.scenario, beforeData.scenario);
  assert.deepEqual(afterData.tags, beforeData.tags);
  assert.equal(afterApply.comment, beforeApply.comment);
  assert.equal(afterApply.avatarPath, beforeApply.avatarPath);
  assert.equal(afterApply.spriteFolderPath, beforeApply.spriteFolderPath);
  assert.equal(afterApply.createdAt, beforeApply.createdAt);

  const restored = await mari.restoreAppliedReview(applyReviewId);
  assert.ok(restored && !("outcome" in restored), "applied personality-model review should restore cleanly");
  assert.deepEqual(await getCharacter("existing-character"), beforeApply, "Restore returns the exact prior character row");

  const beforeMalformed = await getCharacter("existing-character");
  const malformed = asRow(
    await mari.executeAction({
      action: "character.applyPersonalityModel",
      characterId: "existing-character",
      personalityModel: "not-an-object",
      apply: true,
    }),
  );
  assert.equal(malformed.ok, false);
  assert.deepEqual(
    await getCharacter("existing-character"),
    beforeMalformed,
    "malformed selection must fail before any mutation or partial write",
  );

  // Bundled skill lifecycle: seed once, preserve user ownership, and do not reseed after deletion.
  const skills = new ProfessorMariWorkspaceSkillsService();
  const firstSkills = (await skills.list()).skills.filter((skill) => skill.id === "character-personality-model");
  assert.equal(firstSkills.length, 1, "first provisioning seeds exactly one personality-model skill");
  assert.equal(firstSkills[0]!.enabled, true);
  const bundledContent = firstSkills[0]!.content;
  assert.ok(!bundledContent.includes("hopeful-safe"), "skill must not embed the Pearson runtime state catalog");
  assert.ok(!bundledContent.includes("charEmotion"), "skill must not embed the Pearson conditional implementation");
  assert.ok(!bundledContent.includes("{{#if"), "skill must not embed the generated conditional template");

  const repeatedSkills = (await skills.list()).skills.filter((skill) => skill.id === "character-personality-model");
  assert.equal(repeatedSkills.length, 1, "repeated initialization does not duplicate the bundled skill");
  assert.equal(repeatedSkills[0]!.content, bundledContent, "repeated initialization does not overwrite seeded content");

  const customizedContent = "# My personality model guidance\n\nKeep my local customization.";
  await skills.update("character-personality-model", { content: customizedContent, enabled: false });
  const afterUserEdit = new ProfessorMariWorkspaceSkillsService();
  const editedSkill = (await afterUserEdit.list()).skills.find((skill) => skill.id === "character-personality-model");
  assert.ok(editedSkill);
  assert.equal(editedSkill.enabled, false, "user disablement survives later initialization");
  assert.equal(editedSkill.content, customizedContent, "user skill edits survive later initialization");

  await afterUserEdit.delete("character-personality-model");
  const afterDelete = new ProfessorMariWorkspaceSkillsService();
  assert.equal(
    (await afterDelete.list()).skills.some((skill) => skill.id === "character-personality-model"),
    false,
    "deletion is not silently reseeded after the bundled seed version was recorded",
  );

  await db._fileStore.close();
  console.log("professor-mari-personality-model regression passed");
} finally {
  if (previousFileStorageDir === undefined) delete process.env.FILE_STORAGE_DIR;
  else process.env.FILE_STORAGE_DIR = previousFileStorageDir;
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
  rmSync(root, { recursive: true, force: true });
}
