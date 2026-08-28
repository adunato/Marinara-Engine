/**
 * Resolve identity from concrete chat ownership first, then the owning User
 * Profile. The legacy global marker is intentionally only a compatibility
 * fallback while profile state is unavailable.
 */
export function resolveChatPersonaCandidate<T extends { id: string; isActive?: unknown }>(
  personas: readonly T[],
  chatPersonaId: string | null | undefined,
  chatMode: string | null | undefined,
  profileActivePersonaId?: string | null,
): T | null {
  const explicit = chatPersonaId ? personas.find((persona) => persona.id === chatPersonaId) : null;
  if (explicit) return explicit;
  if (chatMode !== "conversation") return null;
  const profilePersona = profileActivePersonaId ? personas.find((persona) => persona.id === profileActivePersonaId) : null;
  if (profilePersona) return profilePersona;
  if (profileActivePersonaId !== undefined) return null;
  return personas.find((persona) => persona.isActive === "true" || persona.isActive === true) ?? null;
}
