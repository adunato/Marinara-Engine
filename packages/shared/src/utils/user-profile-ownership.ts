/**
 * Decide whether a source chat may feed cross-chat context for the request's owning profile.
 * Omitting ownerProfileId preserves pre-profile behavior; otherwise both sides must resolve
 * to the same non-empty id, and unresolvable ownership fails closed (reject).
 */
export function isSameUserProfileOwnership(ownerProfileId: string | null | undefined, sourceProfileId: unknown): boolean {
  if (ownerProfileId === undefined) return true; // legacy compat: no enforcement requested
  const owner = typeof ownerProfileId === "string" ? ownerProfileId.trim() : "";
  const source = typeof sourceProfileId === "string" ? String(sourceProfileId).trim() : "";
  if (!owner || !source) return false; // profile mode + unresolvable ownership → reject
  return owner === source;
}
