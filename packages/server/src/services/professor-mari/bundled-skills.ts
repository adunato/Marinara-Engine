export type ProfessorMariBundledSkill = {
  key: string;
  version: number;
  id: string;
  name: string;
  enabled: boolean;
  description: string;
  content: string;
};

const CHARACTER_PERSONALITY_MODEL_SKILL = `# Character personality model

Use this skill when creating or explicitly reworking a character with Marinara's canonical layered personality model.

Your job is to choose exactly two classifications from the user's character concept and conversation:

1. one Enneagram core type;
2. one attachment style.

Do not write or paraphrase the final canonical personality text yourself. Do not select Pearson modes or emotional states. Marinara owns the fixed Pearson mapping, conditionals, runtime prose, and emotion metadata.

## Enneagram selection

Choose the closest underlying motivational core, not merely the character's surface behaviour.

- \`1\` Reformer — driven by being right, responsible, principled, and consistent with internal standards; sensitive to error, disorder, or moral failure.
- \`2\` Helper — driven by being wanted, valued, useful, and emotionally important to others; sensitive to being unneeded or unappreciated.
- \`3\` Achiever — driven by competence, success, value, and effective self-presentation; sensitive to failure or being seen as unimpressive.
- \`4\` Individualist — driven by authenticity, personal significance, emotional meaning, and distinctive identity; sensitive to being ordinary or misunderstood.
- \`5\` Investigator — driven by understanding, competence, privacy, and conserving internal resources; sensitive to intrusion, depletion, or being unprepared.
- \`6\` Loyalist — driven by finding dependable people, structures, or beliefs in an uncertain world; sensitive to inconsistency, hidden risk, and unreliable trust.
- \`7\` Enthusiast — driven by freedom, options, possibility, and avoiding entrapment or painful limitation; sensitive to restriction and inescapability.
- \`8\` Challenger — driven by autonomy, strength, self-protection, and resistance to control; sensitive to coercion, exploitation, and involuntary vulnerability.
- \`9\` Peacemaker — driven by stability, continuity, harmony, and freedom from disruptive conflict; sensitive to division, pressure, and destabilising confrontation.

When several types could fit, favour the one that best explains *why* the character repeatedly behaves as they do rather than the behaviour itself.

## Attachment-style selection

Choose only from these relationship-regulation patterns. This classification is specifically about intimacy, dependence, rejection, distance, and relational security; do not treat it as the character's whole personality.

- \`secure\` — closeness and temporary distance are generally tolerable; vulnerability and dependence are not automatically treated as threats.
- \`anxious-preoccupied\` — uncertainty or distance tends to activate pursuit, heightened attention, reassurance-seeking, and efforts to restore closeness.
- \`dismissive-avoidant\` — relationship pressure or demanding intimacy tends to activate distance, self-reliance, minimisation of attachment needs, or disengagement.
- \`fearful-avoidant\` — both separation and intimacy can activate threat; connection is desired but vulnerability can trigger withdrawal, producing approach-and-retreat patterns.

## Applying the model

For a new character, call \`app_data\` action \`character.create\` with ordinary character \`data\` plus a top-level \`personalityModel\` object:

\`{ "modelId": "enneagram-pearson-attachment-v1", "enneagramType": "<1-9>", "attachmentStyle": "<style-id>" }\`

For an existing character, call \`character.applyPersonalityModel\` with \`characterId\` and the same top-level \`personalityModel\` object.

When \`personalityModel\` is supplied, Marinara deterministically owns and replaces both the character's complete Personality field and canonical Emotion States profile. Do not also send your own personality text or emotion-profile data as an alternative implementation.
`;

export const PROFESSOR_MARI_BUNDLED_SKILLS: readonly ProfessorMariBundledSkill[] = [
  {
    key: "character-personality-model",
    version: 1,
    id: "character-personality-model",
    name: "character-personality-model",
    enabled: true,
    description:
      "Selects Enneagram and attachment classifications for Marinara's canonical layered character personality model.",
    content: CHARACTER_PERSONALITY_MODEL_SKILL,
  },
] as const;
