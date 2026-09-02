import type {
  CharacterBriefingEntityReference,
  CharacterBriefingInstructionSlot,
} from "../types/character-briefing.js";

export class CharacterBriefingTemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CharacterBriefingTemplateError";
  }
}

function unescapeToken(value: string): string {
  return value.replace(/\\([\\|\]])/g, "$1");
}

export function escapeTokenLabel(value: string): string {
  return value.replace(/[\\|\]]/g, (character) => `\\${character}`);
}

export function serializeCharacterBriefingReference(type: "character" | "lorebook", id: string, label: string): string {
  const normalizedId = id.trim();
  if (!normalizedId || /[\s|\]]/u.test(normalizedId)) throw new CharacterBriefingTemplateError("Invalid entity ID");
  return `$[${type}:${normalizedId}|${escapeTokenLabel(label)}]`;
}

function readReferences(instruction: string, baseOffset: number): CharacterBriefingEntityReference[] {
  const references: CharacterBriefingEntityReference[] = [];
  const pattern = /\$\[(character|lorebook):([^|\]\s]+)\|((?:\\.|[^\]])*)\]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(instruction))) {
    references.push({
      type: match[1] as "character" | "lorebook",
      id: match[2]!,
      label: unescapeToken(match[3] ?? ""),
      startOffset: baseOffset + match.index,
      endOffsetExclusive: baseOffset + match.index + match[0].length,
    });
  }
  if (/\$\[(?:character|lorebook):/u.test(instruction)) {
    const recognized = references.map((reference) =>
      serializeCharacterBriefingReference(reference.type, reference.id, reference.label),
    );
    let remainder = instruction;
    for (const token of recognized) remainder = remainder.replace(token, "");
    if (/\$\[(?:character|lorebook):/u.test(remainder))
      throw new CharacterBriefingTemplateError("Malformed entity reference");
  }
  return references;
}

export function parseCharacterBriefingTemplate(source: string): CharacterBriefingInstructionSlot[] {
  const slots: CharacterBriefingInstructionSlot[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf("[[", cursor);
    if (start < 0) break;
    const end = source.indexOf("]]", start + 2);
    if (end < 0) throw new CharacterBriefingTemplateError("Unclosed Character Briefing instruction");
    const nested = source.indexOf("[[", start + 2);
    if (nested >= 0 && nested < end)
      throw new CharacterBriefingTemplateError("Nested Character Briefing instructions are not supported");
    const instructionStart = start + 2;
    const instruction = source.slice(instructionStart, end);
    slots.push({
      slotIndex: slots.length,
      startOffset: start,
      endOffsetExclusive: end + 2,
      raw: source.slice(start, end + 2),
      instruction,
      references: readReferences(instruction, instructionStart),
    });
    cursor = end + 2;
  }
  return slots;
}

export function reconstructCharacterBriefing(
  source: string,
  slots: CharacterBriefingInstructionSlot[],
  replacements: readonly string[],
): string {
  if (replacements.length !== slots.length) throw new CharacterBriefingTemplateError("Missing briefing replacement");
  let cursor = 0;
  let output = "";
  for (const slot of slots) {
    output += source.slice(cursor, slot.startOffset) + (replacements[slot.slotIndex] ?? "");
    cursor = slot.endOffsetExclusive;
  }
  return output + source.slice(cursor);
}

export function activeCharacterBriefingReferenceQuery(source: string, caretOffset: number): string | null {
  const caret = Math.max(0, Math.min(source.length, caretOffset));
  const open = source.lastIndexOf("[[", caret);
  if (open < 0 || source.lastIndexOf("]]", caret) > open) return null;
  const match = source.slice(open + 2, caret).match(/(?:^|\s)\$([^$[\]|]*)$/u);
  return match ? (match[1] ?? "") : null;
}
