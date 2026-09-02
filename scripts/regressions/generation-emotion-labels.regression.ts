import assert from "node:assert/strict";

import {
  buildGenerationCharacterEmotionSnapshots,
  resolveGenerationEmotionSnapshot,
} from "../../packages/server/src/services/generation/character-emotion-runtime.js";
import {
  resolveMessageGenerationEmotion,
  resolveMessageGenerationEmotionLabel,
} from "../../packages/client/src/lib/message-emotions.js";

const profile = {
  enabled: true,
  defaultStateId: "calm",
  states: [
    { id: "calm", label: "Calm / Open", description: "Settled and receptive." },
    { id: "wary", label: "Wary / Guarded", description: "Cautious and protective." },
  ],
};

assert.deepEqual(resolveGenerationEmotionSnapshot(profile, "wary"), {
  stateId: "wary",
  label: "Wary / Guarded",
});
assert.deepEqual(resolveGenerationEmotionSnapshot(profile, undefined), {
  stateId: "calm",
  label: "Calm / Open",
});
assert.deepEqual(resolveGenerationEmotionSnapshot(profile, "removed-state"), {
  stateId: "calm",
  label: "Calm / Open",
});
assert.equal(resolveGenerationEmotionSnapshot({ ...profile, enabled: false }, "wary"), null);
assert.equal(resolveGenerationEmotionSnapshot(undefined, "wary"), null);

const snapshots = buildGenerationCharacterEmotionSnapshots(
  [
    { id: "character-a", emotionProfile: profile },
    { id: "character-b", emotionProfile: { ...profile, defaultStateId: "wary" } },
  ],
  { "character-a": "wary" },
);
assert.deepEqual(snapshots, {
  "character-a": { stateId: "wary", label: "Wary / Guarded" },
  "character-b": { stateId: "wary", label: "Wary / Guarded" },
});

const message = {
  extra: {
    generationCharacterEmotions: {
      "character-a": { stateId: "wary", label: "Wary / Guarded" },
    },
    characterEmotions: {
      "character-a": "calm",
    },
  },
};
assert.deepEqual(resolveMessageGenerationEmotion(message, "character-a"), {
  stateId: "wary",
  label: "Wary / Guarded",
});
assert.equal(resolveMessageGenerationEmotionLabel(message, "character-a"), "Wary / Guarded");
assert.equal(message.extra.characterEmotions["character-a"], "calm", "post-generation state remains independent");

assert.equal(resolveMessageGenerationEmotionLabel({ extra: {} }, "character-a"), null);
assert.equal(resolveMessageGenerationEmotionLabel({ extra: "{}" }, "character-a"), null);
assert.equal(
  resolveMessageGenerationEmotionLabel(
    { extra: { generationCharacterEmotions: { "character-a": { stateId: "wary", label: "   " } } } },
    "character-a",
  ),
  null,
);
assert.equal(
  resolveMessageGenerationEmotionLabel(
    { extra: { generationCharacterEmotions: { "character-a": { stateId: 7, label: "Wary" } } } },
    "character-a",
  ),
  null,
);

const renamedLiveProfile = {
  ...profile,
  states: profile.states.map((state) => (state.id === "wary" ? { ...state, label: "Renamed live label" } : state)),
};
assert.equal(resolveGenerationEmotionSnapshot(renamedLiveProfile, "wary")?.label, "Renamed live label");
assert.equal(
  resolveMessageGenerationEmotionLabel(message, "character-a"),
  "Wary / Guarded",
  "persisted message label must not follow later card renames",
);

console.info("Generation emotion label regression passed.");
