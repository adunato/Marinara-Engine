import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { CHARACTER_DAILY_MEMORY_DEFAULTS, CHARACTER_DAILY_MEMORY_DEFAULT_PROMPT } from "@marinara-engine/shared";
import type {
  CharacterDailyMemory,
  CharacterDailyMemoryDayStatus,
  CharacterDailyMemoryMissingDay,
  CharacterDailyMemorySettings,
} from "@marinara-engine/shared";
import { useConnections } from "../../hooks/use-connections";
import {
  useAddCharacterDailyMemory,
  useCharacterDailyMemoryConversations,
  useCharacterDailyMemoryDays,
  useCharacterDailyMemorySettings,
  useDeleteCharacterDailyMemory,
  useDeleteCharacterDailyMemoryDay,
  useGenerateCharacterDailyMemoryDay,
  usePatchCharacterDailyMemorySettings,
  usePreviewCharacterDailyMemories,
  useRegenerateCharacterDailyMemoryDay,
  useUpdateCharacterDailyMemory,
} from "../../hooks/use-character-daily-memories";
import type { CharacterDailyMemoryDayView } from "../../lib/character-daily-memories-api";
import { cn } from "../../lib/utils";

interface CharacterMemoriesTabProps {
  characterId: string;
  characterName?: string;
}

type SettingsForm = Pick<
  CharacterDailyMemorySettings,
  | "enabled"
  | "handoverTime"
  | "formationConnectionId"
  | "formationPrompt"
  | "retrievalMessageCount"
  | "semanticWeight"
  | "importanceWeight"
  | "recencyWeight"
  | "minimumRankPercent"
>;

const defaultSettings: SettingsForm = {
  enabled: false,
  handoverTime: CHARACTER_DAILY_MEMORY_DEFAULTS.handoverTime,
  formationConnectionId: null,
  formationPrompt: CHARACTER_DAILY_MEMORY_DEFAULT_PROMPT,
  retrievalMessageCount: CHARACTER_DAILY_MEMORY_DEFAULTS.retrievalMessageCount,
  semanticWeight: CHARACTER_DAILY_MEMORY_DEFAULTS.semanticWeight,
  importanceWeight: CHARACTER_DAILY_MEMORY_DEFAULTS.importanceWeight,
  recencyWeight: CHARACTER_DAILY_MEMORY_DEFAULTS.recencyWeight,
  minimumRankPercent: CHARACTER_DAILY_MEMORY_DEFAULTS.minimumRankPercent,
};

const statusClasses: Record<CharacterDailyMemoryDayStatus, string> = {
  pending: "bg-slate-500/15 text-slate-500",
  partial: "bg-amber-500/15 text-amber-600",
  complete: "bg-emerald-500/15 text-emerald-600",
  empty: "bg-sky-500/15 text-sky-600",
  failed: "bg-red-500/15 text-red-600",
  deleted: "bg-slate-500/15 text-slate-500",
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { dateStyle: "medium" });
}

function StatusBadge({ status }: { status: CharacterDailyMemoryDayStatus }) {
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-wide", statusClasses[status])}>
      {status}
    </span>
  );
}

function MemoryCard({
  memory,
  onDelete,
  onSave,
  deleting,
  saving,
}: {
  memory: CharacterDailyMemory;
  onDelete: () => void;
  onSave: (text: string, importance: number) => Promise<void>;
  deleting: boolean;
  saving: boolean;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(memory.text);
  const [importance, setImportance] = useState(memory.importance);
  const dirty = text !== memory.text || importance !== memory.importance;

  useEffect(() => {
    setText(memory.text);
    setImportance(memory.importance);
  }, [memory.id, memory.importance, memory.text]);

  return (
    <article className="group relative rounded-xl border border-[var(--border)] bg-[var(--background)] p-3">
      <div className="flex items-start gap-2">
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={3}
          aria-label={t("ui.characters.charactermemoriestab.memoryText")}
          className="min-h-20 min-w-0 flex-1 resize-y rounded-lg border border-transparent bg-[var(--accent)]/30 px-2.5 py-2 text-sm outline-none transition-colors focus:border-[var(--primary)]"
        />
        <div className="flex shrink-0 flex-col items-center gap-1">
          <label className="text-[0.625rem] font-semibold uppercase text-[var(--muted-foreground)]" htmlFor={`memory-importance-${memory.id}`}>
            {t("ui.characters.charactermemoriestab.importance")}
          </label>
          <input
            id={`memory-importance-${memory.id}`}
            type="number"
            min={1}
            max={5}
            value={importance}
            onChange={(event) => setImportance(Math.max(1, Math.min(5, Number(event.target.value) || 1)))}
            className="w-12 rounded-lg border border-[var(--border)] bg-[var(--background)] px-1 py-1 text-center text-sm"
          />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[0.6875rem] text-[var(--muted-foreground)]">
        <span>{memory.origin === "manual" ? t("ui.characters.charactermemoriestab.manual") : memory.sourceConversationName || t("ui.characters.charactermemoriestab.formed")}</span>
        {!memory.embeddingSpaceId && (
          <span className="inline-flex items-center gap-1 text-amber-600" title={t("ui.characters.charactermemoriestab.embeddingUnavailableHint")}>
            <AlertTriangle size="0.75rem" />
            {t("ui.characters.charactermemoriestab.textOnly")}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1">
          {dirty && (
            <button
              type="button"
              onClick={() => {
                setText(memory.text);
                setImportance(memory.importance);
              }}
              disabled={saving}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium text-[var(--muted-foreground)] hover:bg-[var(--accent)] disabled:opacity-50"
            >
              <X size="0.75rem" />
              {t("ui.characters.charactermemoriestab.cancel")}
            </button>
          )}
          {dirty && (
            <button
              type="button"
              onClick={() => void onSave(text, importance)}
              disabled={saving || !text.trim()}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium text-[var(--primary)] hover:bg-[var(--accent)] disabled:opacity-50"
            >
              {saving ? <Loader2 size="0.75rem" className="animate-spin" /> : <Save size="0.75rem" />}
              {t("ui.characters.charactermemoriestab.save")}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (window.confirm(t("ui.characters.charactermemoriestab.deleteMemoryConfirmation"))) onDelete();
            }}
            disabled={deleting}
            aria-label={t("ui.characters.charactermemoriestab.deleteMemory")}
            className="inline-flex rounded-md p-1 text-red-500 hover:bg-red-500/10 disabled:opacity-50"
          >
            {deleting ? <Loader2 size="0.75rem" className="animate-spin" /> : <Trash2 size="0.75rem" />}
          </button>
        </span>
      </div>
    </article>
  );
}

function DayGroup({
  view,
  collapsed,
  onToggle,
  characterId,
}: {
  view: CharacterDailyMemoryDayView;
  collapsed: boolean;
  onToggle: () => void;
  characterId: string;
}) {
  const { t } = useTranslation();
  const updateMemory = useUpdateCharacterDailyMemory();
  const deleteMemory = useDeleteCharacterDailyMemory();
  const deleteDay = useDeleteCharacterDailyMemoryDay();
  const regenerate = useRegenerateCharacterDailyMemoryDay();
  const addMemory = useAddCharacterDailyMemory();
  const [newText, setNewText] = useState("");
  const [newImportance, setNewImportance] = useState(3);

  const runBusy = regenerate.isPending || deleteDay.isPending;
  const canRegenerate = view.day.status === "complete" || view.day.status === "empty" || view.day.status === "failed";
  const add = async () => {
    if (!newText.trim()) return;
    try {
      await addMemory.mutateAsync({ characterId, input: { dayId: view.day.id, text: newText, importance: newImportance } });
      setNewText("");
      setNewImportance(3);
      toast.success(t("ui.characters.charactermemoriestab.memoryAdded"));
    } catch (error) {
      toast.error(errorMessage(error, t("ui.characters.charactermemoriestab.saveFailed")));
    }
  };

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--sidebar)]/20">
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-2 px-3 py-3 text-left">
        {collapsed ? <ChevronRight size="1rem" /> : <ChevronDown size="1rem" />}
        <span className="font-semibold">{dateLabel(view.day.windowEndAt)}</span>
        <StatusBadge status={view.day.status} />
        <span className="text-xs text-[var(--muted-foreground)]">{t("ui.characters.charactermemoriestab.memoryCount", { count: view.memories.length })}</span>
        <span className="ml-auto text-xs text-[var(--muted-foreground)]">{view.day.handoverTime}</span>
      </button>
      {!collapsed && (
        <div className="space-y-3 border-t border-[var(--border)] p-3">
          {view.run && view.run.status !== "complete" && view.run.status !== "empty" && (
            <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
              <Clock3 size="0.875rem" />
              {t("ui.characters.charactermemoriestab.runStatus", { status: view.run.status })}
            </div>
          )}
          {view.memories.length > 0 ? (
            view.memories.map((memory) => (
              <MemoryCard
                key={memory.id}
                memory={memory}
                onDelete={() => deleteMemory.mutate({ characterId, memoryId: memory.id })}
                onSave={async (text, importance) => {
                  await updateMemory.mutateAsync({ characterId, input: { memoryId: memory.id, text, importance } });
                }}
                deleting={deleteMemory.isPending}
                saving={updateMemory.isPending}
              />
            ))
          ) : (
            <p className="rounded-lg bg-[var(--accent)]/20 px-3 py-3 text-sm text-[var(--muted-foreground)]">{t("ui.characters.charactermemoriestab.noMemories")}</p>
          )}
          {view.day.status !== "deleted" && (
            <div className="flex flex-col gap-2 rounded-xl border border-dashed border-[var(--border)] p-2 sm:flex-row">
              <input
                value={newText}
                onChange={(event) => setNewText(event.target.value)}
                placeholder={t("ui.characters.charactermemoriestab.addMemoryPlaceholder")}
                className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-2 text-sm"
              />
              <input
                aria-label={t("ui.characters.charactermemoriestab.importance")}
                type="number"
                min={1}
                max={5}
                value={newImportance}
                onChange={(event) => setNewImportance(Math.max(1, Math.min(5, Number(event.target.value) || 1)))}
                className="w-14 rounded-lg border border-[var(--border)] bg-[var(--background)] px-1 py-2 text-center text-sm"
              />
              <button type="button" onClick={() => void add()} disabled={addMemory.isPending || !newText.trim()} className="inline-flex items-center justify-center gap-1 rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
                {addMemory.isPending ? <Loader2 size="0.75rem" className="animate-spin" /> : <Plus size="0.75rem" />}
                {t("ui.characters.charactermemoriestab.addMemory")}
              </button>
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            {canRegenerate && view.day.status !== "deleted" && (
              <button
                type="button"
                disabled={runBusy}
                onClick={() => {
                  if (!window.confirm(t("ui.characters.charactermemoriestab.regenerateConfirmation"))) return;
                  regenerate.mutate({ characterId, dayId: view.day.id });
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--accent)] disabled:opacity-50"
              >
                {regenerate.isPending ? <Loader2 size="0.75rem" className="animate-spin" /> : <RefreshCw size="0.75rem" />}
                {t("ui.characters.charactermemoriestab.regenerate")}
              </button>
            )}
            {view.day.status !== "deleted" && (
              <button
                type="button"
                disabled={runBusy}
                onClick={() => {
                  if (!window.confirm(t("ui.characters.charactermemoriestab.deleteDayConfirmation"))) return;
                  deleteDay.mutate({ characterId, dayId: view.day.id });
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-red-500/30 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-500/10 disabled:opacity-50"
              >
                {deleteDay.isPending ? <Loader2 size="0.75rem" className="animate-spin" /> : <Trash2 size="0.75rem" />}
                {t("ui.characters.charactermemoriestab.deleteDay")}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function MissingDayRow({ missing, characterId }: { missing: CharacterDailyMemoryMissingDay; characterId: string }) {
  const { t } = useTranslation();
  const generate = useGenerateCharacterDailyMemoryDay();
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-[var(--border)] px-3 py-2.5">
      <span className="font-medium">{dateLabel(missing.windowEndAt)}</span>
      <StatusBadge status="deleted" />
      <span className="text-xs text-[var(--muted-foreground)]">{missing.reason === "deleted" ? t("ui.characters.charactermemoriestab.deletedDay") : t("ui.characters.charactermemoriestab.missingDay")}</span>
      <button type="button" onClick={() => generate.mutate({ characterId, window: missing })} disabled={generate.isPending} className="ml-auto inline-flex items-center gap-1 rounded-lg bg-[var(--primary)] px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
        {generate.isPending ? <Loader2 size="0.75rem" className="animate-spin" /> : <RefreshCw size="0.75rem" />}
        {t("ui.characters.charactermemoriestab.generate")}
      </button>
    </div>
  );
}

export function CharacterMemoriesTab({ characterId }: CharacterMemoriesTabProps) {
  const { t } = useTranslation();
  const settingsQuery = useCharacterDailyMemorySettings(characterId);
  const daysQuery = useCharacterDailyMemoryDays(characterId);
  const conversationsQuery = useCharacterDailyMemoryConversations(characterId);
  const connectionsQuery = useConnections();
  const patchSettings = usePatchCharacterDailyMemorySettings();
  const preview = usePreviewCharacterDailyMemories();
  const [settings, setSettings] = useState<SettingsForm>(defaultSettings);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [previewChatId, setPreviewChatId] = useState("");
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!settingsQuery.data || settingsDirty) return;
    setSettings({
      enabled: settingsQuery.data.enabled,
      handoverTime: settingsQuery.data.handoverTime,
      formationConnectionId: settingsQuery.data.formationConnectionId,
      formationPrompt: settingsQuery.data.formationPrompt,
      retrievalMessageCount: settingsQuery.data.retrievalMessageCount,
      semanticWeight: settingsQuery.data.semanticWeight,
      importanceWeight: settingsQuery.data.importanceWeight,
      recencyWeight: settingsQuery.data.recencyWeight,
      minimumRankPercent: settingsQuery.data.minimumRankPercent,
    });
  }, [settingsDirty, settingsQuery.data]);

  const days = useMemo(() => [...(daysQuery.data?.days ?? [])].sort((a, b) => b.day.windowEndAt.localeCompare(a.day.windowEndAt)), [daysQuery.data?.days]);
  const missingDays = daysQuery.data?.missingDays ?? [];
  const connections = useMemo(() => {
    const rows = Array.isArray(connectionsQuery.data) ? connectionsQuery.data : [];
    return rows.filter((connection): connection is { id: string; name: string; provider?: string; model?: string } => {
      if (!connection || typeof connection !== "object") return false;
      const row = connection as Record<string, unknown>;
      return typeof row.id === "string" && typeof row.name === "string" && row.provider !== "image_generation" && row.provider !== "video_generation" && row.provider !== "audio";
    });
  }, [connectionsQuery.data]);

  const update = <K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
    setSettingsDirty(true);
  };

  const save = async () => {
    try {
      await patchSettings.mutateAsync({ characterId, patch: settings });
      setSettingsDirty(false);
      toast.success(t("ui.characters.charactermemoriestab.settingsSaved"));
    } catch (error) {
      toast.error(errorMessage(error, t("ui.characters.charactermemoriestab.saveFailed")));
    }
  };

  if (settingsQuery.isLoading || daysQuery.isLoading) {
    return <div className="flex min-h-64 items-center justify-center"><Loader2 className="animate-spin text-[var(--primary)]" /></div>;
  }

  if (settingsQuery.isError || daysQuery.isError) {
    return <div role="alert" className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600"><AlertTriangle size="1rem" />{t("ui.characters.charactermemoriestab.loadFailed")}</div>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-8">
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--sidebar)]/20 p-4">
        <div className="mb-4 flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold">{t("ui.characters.charactermemoriestab.title")}</h2>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">{t("ui.characters.charactermemoriestab.description")}</p>
          </div>
          <label className="inline-flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={settings.enabled} onChange={(event) => update("enabled", event.target.checked)} className="size-4 accent-[var(--primary)]" />
            {t("ui.characters.charactermemoriestab.enabled")}
          </label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="flex flex-col gap-1 text-xs font-medium"><span>{t("ui.characters.charactermemoriestab.handoverTime")}</span><input type="time" value={settings.handoverTime} onChange={(event) => update("handoverTime", event.target.value)} className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-2 text-sm" /></label>
          <label className="flex flex-col gap-1 text-xs font-medium"><span>{t("ui.characters.charactermemoriestab.formationConnection")}</span><select value={settings.formationConnectionId ?? ""} onChange={(event) => update("formationConnectionId", event.target.value || null)} className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-2 text-sm"><option value="">{t("ui.characters.charactermemoriestab.agentDefault")}</option>{connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.name}{connection.model ? ` · ${connection.model}` : ""}</option>)}</select></label>
          <label className="flex flex-col gap-1 text-xs font-medium"><span>{t("ui.characters.charactermemoriestab.recentMessages")}</span><input type="number" min={0} max={100} value={settings.retrievalMessageCount} onChange={(event) => update("retrievalMessageCount", Math.max(0, Number(event.target.value) || 0))} className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-2 text-sm" /></label>
        </div>
        <div className="mt-4 grid gap-x-5 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
          {(["semanticWeight", "importanceWeight", "recencyWeight", "minimumRankPercent"] as const).map((key) => (
            <label key={key} className="flex flex-col gap-1 text-xs font-medium"><span>{t(`ui.characters.charactermemoriestab.${key}`)}</span><input type="range" min={0} max={100} value={settings[key]} onChange={(event) => update(key, Number(event.target.value))} /><span className="text-right text-[var(--muted-foreground)]">{settings[key]}%</span></label>
          ))}
        </div>
        <label className="mt-4 flex flex-col gap-1 text-xs font-medium"><span>{t("ui.characters.charactermemoriestab.formationPrompt")}</span><textarea value={settings.formationPrompt} onChange={(event) => update("formationPrompt", event.target.value)} rows={4} className="resize-y rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-2 text-sm" /></label>
        <div className="mt-2 flex flex-wrap justify-end gap-2"><button type="button" onClick={() => update("formationPrompt", CHARACTER_DAILY_MEMORY_DEFAULT_PROMPT)} className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--accent)]"><X size="0.75rem" />{t("ui.characters.charactermemoriestab.reset")}</button><button type="button" onClick={() => void save()} disabled={!settingsDirty || patchSettings.isPending} className="inline-flex items-center gap-1 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{patchSettings.isPending ? <Loader2 size="0.75rem" className="animate-spin" /> : <Check size="0.75rem" />}{t("ui.characters.charactermemoriestab.saveSettings")}</button></div>
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--sidebar)]/20 p-4">
        <div className="flex flex-wrap items-end gap-3"><label className="flex min-w-56 flex-1 flex-col gap-1 text-xs font-medium"><span>{t("ui.characters.charactermemoriestab.previewConversation")}</span><select value={previewChatId} onChange={(event) => setPreviewChatId(event.target.value)} className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-2 text-sm"><option value="">{t("ui.characters.charactermemoriestab.chooseConversation")}</option>{(conversationsQuery.data ?? []).map((conversation) => <option key={conversation.id} value={conversation.id}>{conversation.name}</option>)}</select></label><button type="button" disabled={!previewChatId || preview.isPending} onClick={() => preview.mutate({ characterId, chatId: previewChatId })} className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold hover:bg-[var(--accent)] disabled:opacity-50">{preview.isPending ? <Loader2 size="0.75rem" className="animate-spin" /> : <RefreshCw size="0.75rem" />}{t("ui.characters.charactermemoriestab.preview")}</button></div>
        {preview.isError && <p role="alert" className="mt-3 text-xs text-red-600">{errorMessage(preview.error, t("ui.characters.charactermemoriestab.previewFailed"))}</p>}
        {preview.data && <div className="mt-3 space-y-2 rounded-xl bg-[var(--accent)]/20 p-3"><p className="text-xs font-semibold">{t("ui.characters.charactermemoriestab.previewResults")}</p>{preview.data.memories.length === 0 ? <p className="text-xs text-[var(--muted-foreground)]">{t("ui.characters.charactermemoriestab.noMatches")}</p> : preview.data.memories.map((memory) => <div key={memory.id} className="flex items-start gap-2 text-sm"><span className="mt-0.5 rounded bg-[var(--primary)]/15 px-1.5 py-0.5 text-xs font-semibold">{memory.rankScore?.toFixed(2) ?? "—"}</span><span>{memory.text}</span></div>)}</div>}
      </section>

      <section className="flex min-h-0 flex-col gap-3">
        <div className="flex items-center gap-2"><h2 className="text-base font-semibold">{t("ui.characters.charactermemoriestab.days")}</h2><span className="text-xs text-[var(--muted-foreground)]">{t("ui.characters.charactermemoriestab.dayCount", { count: days.length })}</span></div>
        {missingDays.map((missing) => <MissingDayRow key={`${missing.windowEndAt}-${missing.reason}`} missing={missing} characterId={characterId} />)}
        {days.length === 0 && missingDays.length === 0 ? <div className="rounded-xl border border-dashed border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--muted-foreground)]">{t("ui.characters.charactermemoriestab.noDays")}</div> : days.map((view) => <DayGroup key={view.day.id} view={view} characterId={characterId} collapsed={collapsedDays.has(view.day.id)} onToggle={() => setCollapsedDays((current) => { const next = new Set(current); if (next.has(view.day.id)) next.delete(view.day.id); else next.add(view.day.id); return next; })} />)}
      </section>
    </div>
  );
}
