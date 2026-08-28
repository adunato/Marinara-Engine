import assert from "node:assert/strict";
import { characterEmotionProfileSchema } from "../../packages/shared/src/schemas/character.schema.js";
import {
  ATTACHMENT_DEFINITIONS,
  ATTACHMENT_STYLE_IDS,
  CHARACTER_PERSONALITY_DEFAULT_STATE_ID,
  CHARACTER_PERSONALITY_MODEL_ID,
  ENNEAGRAM_DEFINITIONS,
  ENNEAGRAM_TYPE_IDS,
  PEARSON_STATE_DEFINITIONS,
  compileCharacterPersonalityModel,
  type AttachmentStyleId,
  type EnneagramTypeId,
} from "../../packages/shared/src/utils/character-personality-model.js";

const EXPECTED_ENNEAGRAM: Record<EnneagramTypeId, string> = {
  "1": "Strongly guided by an internal sense of what is right, responsible, and acceptable. The character is naturally sensitive to mistakes, inconsistency, and falling short of standards, both in themselves and in others. They tend to evaluate choices against an internal ideal and can experience tension when personal desires conflict with what they believe they should do.",
  "2": "Strongly motivated by feeling valued, wanted, and significant to other people. The character is highly sensitive to whether they matter in a relationship and often derives self-worth from being useful, appreciated, or emotionally important. They may struggle to distinguish genuine generosity from the need for recognition or closeness in return.",
  "3": "Strongly oriented toward competence, value, and successful self-presentation. The character is sensitive to whether they are succeeding, failing, or being seen as impressive by people whose judgment matters to them. They readily shape their identity around what appears valuable or effective and may have difficulty separating authentic wants from the image they feel expected to maintain.",
  "4": "Strongly invested in having an authentic, distinctive, and emotionally meaningful identity. The character is highly sensitive to what feels personally significant, missing, or uniquely their own, and tends to experience emotional differences with unusual intensity. They may become preoccupied with whether others truly understand them or whether their life and relationships feel sufficiently meaningful.",
  "5": "Strongly motivated by maintaining competence, understanding, and personal autonomy. The character is sensitive to demands that feel intrusive, draining, or beyond their ability to manage and tends to protect their internal resources carefully. They feel safer when they have enough knowledge, privacy, and independence to engage with the world on their own terms.",
  "6": "Strongly concerned with finding something dependable in an uncertain world. The character is highly sensitive to trust, consistency, hidden risks, and whether people or situations can be relied upon. They tend to mentally test assumptions and loyalties and may experience persistent tension between wanting dependable support and doubting whether it is truly safe to rely on it.",
  "7": "Strongly motivated by freedom, possibility, and avoiding a sense of limitation or entrapment. The character is sensitive to boredom, restriction, and situations that feel emotionally or practically inescapable. They tend to orient toward future options and alternatives, using possibility itself as a way of maintaining a sense of movement and psychological freedom.",
  "8": "Strongly motivated by autonomy, self-protection, and resistance to being controlled or made vulnerable against their will. The character is highly sensitive to coercion, manipulation, weakness being exploited, and unequal power. They place great value on agency and personal strength and may find dependence or exposed vulnerability psychologically difficult even when they desire closeness.",
  "9": "Strongly motivated by internal stability, continuity, and freedom from disruptive conflict. The character is highly sensitive to situations that threaten harmony or force difficult divisions between competing needs. They tend to absorb other people's perspectives easily and may lose clarity about their own priorities when asserting them risks creating tension, separation, or instability.",
};

const EXPECTED_ATTACHMENT: Record<AttachmentStyleId, string> = {
  secure:
    "Closeness is generally experienced as safe. The character can seek affection, express vulnerability, and tolerate temporary distance without automatically treating either dependence or separation as threatening.",
  "anxious-preoccupied":
    "Relationship uncertainty tends to activate pursuit. Ambiguous distance, reduced affection, or possible rejection receives heightened attention and can create pressure to restore reassurance, closeness, and a sense of connection.",
  "dismissive-avoidant":
    "Relationship pressure tends to activate distance. The character protects autonomy by minimising attachment needs, suppressing vulnerability, or disengaging when intimacy begins to feel demanding or intrusive.",
  "fearful-avoidant":
    "Both separation and intimacy can feel threatening. The character desires connection but may retreat when vulnerability becomes intense, creating a tendency toward approach-and-withdraw dynamics in emotionally significant relationships.",
};

assert.deepEqual(
  ENNEAGRAM_DEFINITIONS.map(({ id, description }) => [id, description]),
  ENNEAGRAM_TYPE_IDS.map((id) => [id, EXPECTED_ENNEAGRAM[id]]),
  "all nine canonical Enneagram definitions remain the approved final paragraphs",
);
assert.deepEqual(
  ATTACHMENT_DEFINITIONS.map(({ id, description }) => [id, description]),
  ATTACHMENT_STYLE_IDS.map((id) => [id, EXPECTED_ATTACHMENT[id]]),
  "all four canonical attachment definitions remain the approved final paragraphs",
);

const canonicalStateIds = PEARSON_STATE_DEFINITIONS.map((state) => state.id);
const canonicalLabels = PEARSON_STATE_DEFINITIONS.map((state) => state.mentalState);
assert.equal(canonicalStateIds.length, 12, "the model has exactly twelve Pearson states");
assert.equal(new Set(canonicalStateIds).size, 12, "Pearson state ids are unique");
assert.equal(new Set(canonicalLabels).size, 12, "Pearson state labels are unique");
assert.ok(canonicalStateIds.includes(CHARACTER_PERSONALITY_DEFAULT_STATE_ID), "the default state exists");
assert.equal(CHARACTER_PERSONALITY_DEFAULT_STATE_ID, "wary-grounded", "the fallback stays Wary / Grounded");
for (const state of PEARSON_STATE_DEFINITIONS) {
  assert.ok(state.classifierDescription.trim(), `${state.id} has classifier guidance`);
  assert.ok(state.classifierDescription.length <= 500, `${state.id} classifier guidance stays within schema limits`);
}

for (const enneagramType of ENNEAGRAM_TYPE_IDS) {
  for (const attachmentStyle of ATTACHMENT_STYLE_IDS) {
    const selection = { modelId: CHARACTER_PERSONALITY_MODEL_ID, enneagramType, attachmentStyle } as const;
    const first = compileCharacterPersonalityModel(selection);
    const second = compileCharacterPersonalityModel(selection);

    assert.equal(first.personality, second.personality, "repeat compilation is byte-identical");
    assert.deepEqual(first.emotionProfile, second.emotionProfile, "repeat compilation is object-equivalent");
    assert.notStrictEqual(first.emotionProfile, second.emotionProfile, "repeat compilation returns a fresh profile object");
    assert.notStrictEqual(first.emotionProfile.states, second.emotionProfile.states, "repeat compilation returns a fresh states array");

    assert.ok(first.personality.startsWith(`${EXPECTED_ENNEAGRAM[enneagramType]}\n\n`));
    assert.ok(first.personality.endsWith(`\n\nAttachment Style\n${EXPECTED_ATTACHMENT[attachmentStyle]}`));

    let previousIndex = -1;
    for (const [index, state] of PEARSON_STATE_DEFINITIONS.entries()) {
      const marker = `${index === 0 ? "{{#if" : "{{else if"} charEmotion == \"${state.id}\"}}`;
      const markerIndex = first.personality.indexOf(marker);
      assert.ok(markerIndex > previousIndex, `${state.id} appears in canonical order`);
      assert.equal(first.personality.split(marker).length - 1, 1, `${state.id} conditional appears exactly once`);
      assert.ok(first.personality.includes(`${marker}\n${state.description}`), `${state.id} uses the approved runtime prose`);
      previousIndex = markerIndex;
    }
    assert.equal(first.personality.split("{{/if}}").length - 1, 1, "the Pearson conditional closes exactly once");

    assert.deepEqual(
      first.emotionProfile.states.map((state) => state.id),
      canonicalStateIds,
      "emotion-profile ids exactly match the Pearson conditional ids",
    );
    assert.deepEqual(
      first.emotionProfile.states.map((state) => state.label),
      canonicalLabels,
      "emotion-profile labels exactly match the canonical mental-state labels",
    );
    assert.equal(first.emotionProfile.enabled, true);
    assert.equal(first.emotionProfile.defaultStateId, "wary-grounded");
    characterEmotionProfileSchema.parse(first.emotionProfile);
  }
}

assert.throws(
  () =>
    compileCharacterPersonalityModel({
      modelId: "unsupported-model" as typeof CHARACTER_PERSONALITY_MODEL_ID,
      enneagramType: "1",
      attachmentStyle: "secure",
    }),
  /Unsupported character personality model/,
);
assert.throws(
  () => compileCharacterPersonalityModel({ enneagramType: "0" as EnneagramTypeId, attachmentStyle: "secure" }),
  /Unsupported Enneagram type/,
);
assert.throws(
  () => compileCharacterPersonalityModel({ enneagramType: "1", attachmentStyle: "unknown" as AttachmentStyleId }),
  /Unsupported attachment style/,
);

console.log("character-personality-model regression passed");
