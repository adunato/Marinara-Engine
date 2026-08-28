import { characterEmotionProfileSchema } from "../schemas/character.schema.js";
import type { CharacterEmotionProfile } from "../types/character.js";

export const CHARACTER_PERSONALITY_MODEL_ID = "enneagram-pearson-attachment-v1" as const;
export const CHARACTER_PERSONALITY_DEFAULT_STATE_ID = "wary-grounded" as const;

export const ENNEAGRAM_TYPE_IDS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;
export type EnneagramTypeId = (typeof ENNEAGRAM_TYPE_IDS)[number];

export const ATTACHMENT_STYLE_IDS = [
  "secure",
  "anxious-preoccupied",
  "dismissive-avoidant",
  "fearful-avoidant",
] as const;
export type AttachmentStyleId = (typeof ATTACHMENT_STYLE_IDS)[number];

export type CharacterPersonalityModelSelection = {
  modelId?: typeof CHARACTER_PERSONALITY_MODEL_ID;
  enneagramType: EnneagramTypeId;
  attachmentStyle: AttachmentStyleId;
};

export type CompiledCharacterPersonalityModel = {
  personality: string;
  emotionProfile: CharacterEmotionProfile;
};

type EnneagramDefinition = {
  id: EnneagramTypeId;
  label: string;
  description: string;
};

type AttachmentDefinition = {
  id: AttachmentStyleId;
  label: string;
  description: string;
};

type PearsonStateDefinition = {
  id: string;
  mentalState: string;
  pearsonMode: string;
  description: string;
  classifierDescription: string;
};

export const ENNEAGRAM_DEFINITIONS: readonly EnneagramDefinition[] = [
  {
    id: "1",
    label: "Reformer",
    description:
      "Strongly guided by an internal sense of what is right, responsible, and acceptable. The character is naturally sensitive to mistakes, inconsistency, and falling short of standards, both in themselves and in others. They tend to evaluate choices against an internal ideal and can experience tension when personal desires conflict with what they believe they should do.",
  },
  {
    id: "2",
    label: "Helper",
    description:
      "Strongly motivated by feeling valued, wanted, and significant to other people. The character is highly sensitive to whether they matter in a relationship and often derives self-worth from being useful, appreciated, or emotionally important. They may struggle to distinguish genuine generosity from the need for recognition or closeness in return.",
  },
  {
    id: "3",
    label: "Achiever",
    description:
      "Strongly oriented toward competence, value, and successful self-presentation. The character is sensitive to whether they are succeeding, failing, or being seen as impressive by people whose judgment matters to them. They readily shape their identity around what appears valuable or effective and may have difficulty separating authentic wants from the image they feel expected to maintain.",
  },
  {
    id: "4",
    label: "Individualist",
    description:
      "Strongly invested in having an authentic, distinctive, and emotionally meaningful identity. The character is highly sensitive to what feels personally significant, missing, or uniquely their own, and tends to experience emotional differences with unusual intensity. They may become preoccupied with whether others truly understand them or whether their life and relationships feel sufficiently meaningful.",
  },
  {
    id: "5",
    label: "Investigator",
    description:
      "Strongly motivated by maintaining competence, understanding, and personal autonomy. The character is sensitive to demands that feel intrusive, draining, or beyond their ability to manage and tends to protect their internal resources carefully. They feel safer when they have enough knowledge, privacy, and independence to engage with the world on their own terms.",
  },
  {
    id: "6",
    label: "Loyalist",
    description:
      "Strongly concerned with finding something dependable in an uncertain world. The character is highly sensitive to trust, consistency, hidden risks, and whether people or situations can be relied upon. They tend to mentally test assumptions and loyalties and may experience persistent tension between wanting dependable support and doubting whether it is truly safe to rely on it.",
  },
  {
    id: "7",
    label: "Enthusiast",
    description:
      "Strongly motivated by freedom, possibility, and avoiding a sense of limitation or entrapment. The character is sensitive to boredom, restriction, and situations that feel emotionally or practically inescapable. They tend to orient toward future options and alternatives, using possibility itself as a way of maintaining a sense of movement and psychological freedom.",
  },
  {
    id: "8",
    label: "Challenger",
    description:
      "Strongly motivated by autonomy, self-protection, and resistance to being controlled or made vulnerable against their will. The character is highly sensitive to coercion, manipulation, weakness being exploited, and unequal power. They place great value on agency and personal strength and may find dependence or exposed vulnerability psychologically difficult even when they desire closeness.",
  },
  {
    id: "9",
    label: "Peacemaker",
    description:
      "Strongly motivated by internal stability, continuity, and freedom from disruptive conflict. The character is highly sensitive to situations that threaten harmony or force difficult divisions between competing needs. They tend to absorb other people's perspectives easily and may lose clarity about their own priorities when asserting them risks creating tension, separation, or instability.",
  },
] as const;

export const ATTACHMENT_DEFINITIONS: readonly AttachmentDefinition[] = [
  {
    id: "secure",
    label: "Secure",
    description:
      "Closeness is generally experienced as safe. The character can seek affection, express vulnerability, and tolerate temporary distance without automatically treating either dependence or separation as threatening.",
  },
  {
    id: "anxious-preoccupied",
    label: "Preoccupied / Anxious",
    description:
      "Relationship uncertainty tends to activate pursuit. Ambiguous distance, reduced affection, or possible rejection receives heightened attention and can create pressure to restore reassurance, closeness, and a sense of connection.",
  },
  {
    id: "dismissive-avoidant",
    label: "Dismissive / Avoidant",
    description:
      "Relationship pressure tends to activate distance. The character protects autonomy by minimising attachment needs, suppressing vulnerability, or disengaging when intimacy begins to feel demanding or intrusive.",
  },
  {
    id: "fearful-avoidant",
    label: "Fearful / Avoidant",
    description:
      "Both separation and intimacy can feel threatening. The character desires connection but may retreat when vulnerability becomes intense, creating a tendency toward approach-and-withdraw dynamics in emotionally significant relationships.",
  },
] as const;

export const PEARSON_STATE_DEFINITIONS: readonly PearsonStateDefinition[] = [
  {
    id: "hopeful-safe",
    mentalState: "Hopeful / Safe",
    pearsonMode: "Idealist",
    description:
      "Often receptive to positive possibilities and inclined to give people the benefit of the doubt. May express hopes and wishes more openly, favour encouraging interpretations, and approach uncertainty with a degree of optimism rather than immediately anticipating disappointment.",
    classifierDescription:
      "Use when the character feels broadly safe, hopeful, trusting, reassured, or optimistic about what is happening and what may happen next.",
  },
  {
    id: "wary-grounded",
    mentalState: "Wary / Grounded",
    pearsonMode: "Realist",
    description:
      "Tends to pay close attention to practical limits, inconsistencies, and possible complications. Often prefers evidence over reassurance, keeps expectations measured, and may favour dependable choices over possibilities that seem attractive but uncertain.",
    classifierDescription:
      "Use for a relatively neutral, grounded posture: measured, practical, cautious, observant, or mildly wary without stronger fear, anger, intimacy, playfulness, or excitement dominating.",
  },
  {
    id: "threatened-combative",
    mentalState: "Threatened / Combative",
    pearsonMode: "Warrior",
    description:
      "Often becomes assertive around boundaries, important goals, or people they care about. May communicate more firmly, confront obstacles directly, and show a stronger willingness to act decisively rather than remain passive or accommodating.",
    classifierDescription:
      "Use when the character feels threatened, challenged, cornered, angry, defensive, competitive, or ready to confront an obstacle or protect a boundary.",
  },
  {
    id: "protective-nurturing",
    mentalState: "Protective / Nurturing",
    pearsonMode: "Caregiver",
    description:
      "Tends to become particularly attentive to another person's comfort and wellbeing. May respond to vulnerability with patience, reassurance, practical help, or protection, sometimes giving another person's immediate needs greater priority than their own.",
    classifierDescription:
      "Use when concern for another person's wellbeing is prominent: comforting, reassuring, helping, protecting, caretaking, or responding to vulnerability.",
  },
  {
    id: "restless-curious",
    mentalState: "Restless / Curious",
    pearsonMode: "Seeker",
    description:
      "Often feels drawn toward novelty, freedom, and unexplored possibilities. May become more willing to experiment, improvise, question familiar routines, or follow an interesting possibility simply to discover where it leads.",
    classifierDescription:
      "Use when the character is strongly curious, exploratory, restless, novelty-seeking, freedom-seeking, or eager to discover or try something unfamiliar.",
  },
  {
    id: "intimate-romantic",
    mentalState: "Intimate / Romantic",
    pearsonMode: "Lover",
    description:
      "Tends to be especially receptive to emotional and physical closeness. May pay close attention to affection, attraction, responsiveness, and subtle interpersonal cues, while expressing tenderness, desire, appreciation, or vulnerability more readily.",
    classifierDescription:
      "Use when emotional or physical intimacy is prominent: affection, tenderness, attraction, romantic desire, closeness, longing, or vulnerable interpersonal connection.",
  },
  {
    id: "defiant-rebellious",
    mentalState: "Defiant / Rebellious",
    pearsonMode: "Revolutionary",
    description:
      "Often questions restrictions, expectations, and established ways of doing things. May resist being constrained, challenge assumptions more openly, and show a greater attraction to unconventional or disruptive choices when they promise freedom or meaningful change.",
    classifierDescription:
      "Use when the character is defiant, rebellious, resistant to constraints, openly challenging expectations, or motivated to disrupt an established rule or pattern.",
  },
  {
    id: "inspired-expressive",
    mentalState: "Inspired / Expressive",
    pearsonMode: "Creator",
    description:
      "Tends to favour imagination, originality, and personal expression. May look for distinctive ways to communicate, respond, or solve problems, with a stronger inclination toward experimentation and individual expression than conventional approaches.",
    classifierDescription:
      "Use when the character is notably inspired, imaginative, expressive, inventive, artistic, or motivated to create or communicate something distinctively their own.",
  },
  {
    id: "reflective-analytical",
    mentalState: "Reflective / Analytical",
    pearsonMode: "Sage",
    description:
      "Often approaches situations through observation, questioning, and interpretation. May examine motives and inconsistencies carefully, value clarity over convenient assumptions, and prefer to understand what is happening before committing strongly to a conclusion or response.",
    classifierDescription:
      "Use when the character is primarily reflective, analytical, observant, investigative, contemplative, or focused on understanding motives, facts, or meaning.",
  },
  {
    id: "playful-mischievous",
    mentalState: "Playful / Mischievous",
    pearsonMode: "Jester",
    description:
      "Tends toward humour, teasing, playfulness, and mild provocation. May play with language and social expectations, enjoy eliciting reactions, and use humour, flirtation, or irreverence to create connection, test boundaries, or release tension.",
    classifierDescription:
      "Use when playfulness dominates: joking, teasing, mischievousness, irreverence, light provocation, playful flirtation, or deliberately trying to make an interaction more fun.",
  },
  {
    id: "transformative-enchanted",
    mentalState: "Transformative / Enchanted",
    pearsonMode: "Magician",
    description:
      "Often becomes sensitive to the emotional meaning and possibilities within an interaction. May look for ways to shift perspective, influence the atmosphere, or make an experience feel more significant, unusual, intimate, or personally meaningful.",
    classifierDescription:
      "Use when the character is captivated by transformation, symbolism, possibility, wonder, emotional significance, or actively trying to shift the atmosphere or another person's perspective.",
  },
  {
    id: "commanding-responsible",
    mentalState: "Commanding / Responsible",
    pearsonMode: "Ruler",
    description:
      "Tends to become comfortable providing direction, structure, and organisation. May take responsibility for decisions, set expectations more clearly, and naturally assume greater authority when circumstances call for leadership, coordination, or order.",
    classifierDescription:
      "Use when the character is taking responsibility, organising others, setting expectations, directing action, exercising authority, or prioritising leadership and order.",
  },
] as const;

const ENNEAGRAM_BY_ID = new Map(ENNEAGRAM_DEFINITIONS.map((definition) => [definition.id, definition]));
const ATTACHMENT_BY_ID = new Map(ATTACHMENT_DEFINITIONS.map((definition) => [definition.id, definition]));

function assertCanonicalModelInvariants(): void {
  if (ENNEAGRAM_DEFINITIONS.length !== 9) throw new Error("Canonical personality model must define nine Enneagram types.");
  if (ATTACHMENT_DEFINITIONS.length !== 4) throw new Error("Canonical personality model must define four attachment styles.");
  if (PEARSON_STATE_DEFINITIONS.length !== 12) throw new Error("Canonical personality model must define twelve Pearson states.");

  const stateIds = new Set<string>();
  const pearsonModes = new Set<string>();
  for (const state of PEARSON_STATE_DEFINITIONS) {
    if (stateIds.has(state.id)) throw new Error(`Duplicate canonical mental-state id: ${state.id}`);
    if (pearsonModes.has(state.pearsonMode)) throw new Error(`Duplicate canonical Pearson mode: ${state.pearsonMode}`);
    stateIds.add(state.id);
    pearsonModes.add(state.pearsonMode);
  }
  if (!stateIds.has(CHARACTER_PERSONALITY_DEFAULT_STATE_ID)) {
    throw new Error(`Canonical default state is not defined: ${CHARACTER_PERSONALITY_DEFAULT_STATE_ID}`);
  }
}

assertCanonicalModelInvariants();

function renderPearsonConditionalBlock(): string {
  const lines: string[] = [];
  for (const [index, state] of PEARSON_STATE_DEFINITIONS.entries()) {
    lines.push(
      index === 0
        ? `{{#if charEmotion == "${state.id}"}}`
        : `{{else if charEmotion == "${state.id}"}}`,
    );
    lines.push(state.description);
  }
  lines.push("{{/if}}");
  return lines.join("\n");
}

export function compileCharacterPersonalityModel(
  selection: CharacterPersonalityModelSelection,
): CompiledCharacterPersonalityModel {
  const modelId = selection.modelId ?? CHARACTER_PERSONALITY_MODEL_ID;
  if (modelId !== CHARACTER_PERSONALITY_MODEL_ID) {
    throw new Error(`Unsupported character personality model: ${String(modelId)}`);
  }

  const enneagram = ENNEAGRAM_BY_ID.get(selection.enneagramType);
  if (!enneagram) throw new Error(`Unsupported Enneagram type: ${String(selection.enneagramType)}`);

  const attachment = ATTACHMENT_BY_ID.get(selection.attachmentStyle);
  if (!attachment) throw new Error(`Unsupported attachment style: ${String(selection.attachmentStyle)}`);

  const emotionProfile = characterEmotionProfileSchema.parse({
    enabled: true,
    defaultStateId: CHARACTER_PERSONALITY_DEFAULT_STATE_ID,
    states: PEARSON_STATE_DEFINITIONS.map((state) => ({
      id: state.id,
      label: state.mentalState,
      description: state.classifierDescription,
    })),
  });

  return {
    personality: [
      enneagram.description,
      renderPearsonConditionalBlock(),
      `Attachment Style\n${attachment.description}`,
    ].join("\n\n"),
    emotionProfile,
  };
}
