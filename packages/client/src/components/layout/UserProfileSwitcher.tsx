import { Pencil, Plus, Users } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useCreateUserProfile, useSwitchUserProfile, useUpdateUserProfile, useUserProfiles } from "../../hooks/use-user-profiles";
import { useUserProfileStore } from "../../stores/user-profile.store";

export function UserProfileSwitcher() {
  const { data: profiles = [] } = useUserProfiles();
  const activeProfile = useUserProfileStore((state) => state.activeProfile);
  const switching = useUserProfileStore((state) => state.isSwitching);
  const switchProfile = useSwitchUserProfile();
  const create = useCreateUserProfile();
  const update = useUpdateUserProfile();
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);

  const createProfile = async () => {
    const name = window.prompt(t("ui.userProfile.createPrompt"));
    if (!name?.trim()) return;
    try {
      const profile = await create.mutateAsync({ name: name.trim() });
      await switchProfile(profile.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("ui.userProfile.createError"));
    }
  };
  const renameProfile = async () => {
    if (!activeProfile) return;
    const name = window.prompt(t("ui.userProfile.renamePrompt"), activeProfile.name);
    if (!name?.trim() || name.trim() === activeProfile.name) return;
    try {
      await update.mutateAsync({ id: activeProfile.id, name: name.trim() });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("ui.userProfile.renameError"));
    }
  };

  return (
    <div className="flex min-w-0 items-center gap-1" aria-label={t("ui.userProfile.label")}>
      <Users size="0.875rem" className="shrink-0 text-[var(--muted-foreground)]" />
      <select
        aria-label={t("ui.userProfile.label")}
        className="max-w-28 bg-transparent text-xs font-medium outline-none"
        disabled={switching || !activeProfile}
        value={activeProfile?.id ?? ""}
        onChange={(event) => void switchProfile(event.target.value).catch((cause) => setError(String(cause)))}
      >
        {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
      </select>
      <button type="button" aria-label={t("ui.userProfile.create")} className="p-1 active:scale-90" onClick={() => void createProfile()}><Plus size="0.75rem" /></button>
      <button type="button" aria-label={t("ui.userProfile.rename")} className="p-1 active:scale-90" onClick={() => void renameProfile()}><Pencil size="0.75rem" /></button>
      {error ? <span className="sr-only" role="alert">{error}</span> : null}
    </div>
  );
}
