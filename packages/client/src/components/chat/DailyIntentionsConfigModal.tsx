import {
  DEFAULT_DAILY_INTENTION_AREAS,
  type DailyIntentionAreaKey,
  type DailyIntentionsSettings,
} from "@marinara-engine/shared";
import { Loader2, RotateCcw, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { useConnections } from "../../hooks/use-connections";
import { useDailyIntentions, useUpdateDailyIntentionsSettings } from "../../hooks/use-daily-intentions";
import { Modal } from "../ui/Modal";
import { useTranslation as useUiTranslation } from "react-i18next";

interface DailyIntentionsConfigModalProps {
  chatId: string;
  open: boolean;
  onClose: () => void;
}

export function DailyIntentionsConfigModal({ chatId, open, onClose }: DailyIntentionsConfigModalProps) {
  const { t: localizeUi } = useUiTranslation();
  const query = useDailyIntentions(chatId, open);
  const update = useUpdateDailyIntentionsSettings(chatId);
  const { data: connections = [] } = useConnections();
  const connectionOptions = connections as Array<{ id: string; name: string; model?: string }>;
  const [draft, setDraft] = useState<DailyIntentionsSettings | null>(null);

  useEffect(() => {
    if (open && query.data) setDraft(structuredClone(query.data.settings));
  }, [open, query.data]);

  const dirty = useMemo(
    () => Boolean(draft && query.data && JSON.stringify(draft) !== JSON.stringify(query.data.settings)),
    [draft, query.data],
  );

  const close = () => {
    if (
      dirty &&
      !window.confirm(localizeUi("ui.chat.dailyintentionsconfigmodal.discardDailyIntentionsConfigurationChanges"))
    )
      return;
    onClose();
  };

  const patchArea = (key: DailyIntentionAreaKey, patch: { heading?: string; prompt?: string; enabled?: boolean }) => {
    setDraft((current) =>
      current
        ? { ...current, areas: current.areas.map((area) => (area.key === key ? { ...area, ...patch } : area)) }
        : current,
    );
  };

  const save = async () => {
    if (!draft) return;
    try {
      await update.mutateAsync(draft);
      toast.success(localizeUi("ui.chat.dailyintentionsconfigmodal.dailyIntentionsSettingsSaved"));
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : localizeUi("ui.chat.dailyintentionsconfigmodal.couldNotSaveDailyIntentionsSettings"),
      );
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={localizeUi("ui.chat.dailyintentionsconfigmodal.configureDailyIntentions")}
      width="max-w-4xl"
      chatFloatingPanel
    >
      {query.isLoading || !draft ? (
        <div className="flex min-h-40 items-center justify-center">
          <Loader2 className="animate-spin text-[var(--primary)]" size="1.25rem" />
        </div>
      ) : query.isError ? (
        <p className="py-8 text-center text-sm text-red-400">
          {localizeUi("ui.chat.dailyintentionsconfigmodal.couldNotLoadDailyIntentionsConfiguration")}
        </p>
      ) : (
        <div className="space-y-4" data-testid="daily-intentions-config">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--secondary)]/60 p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5 text-xs font-medium">
                <span>{localizeUi("ui.noodle.noodlehome.generationConnection")}</span>
                <select
                  aria-label={localizeUi("ui.chat.dailyintentionsconfigmodal.dailyIntentionsGenerationConnection")}
                  value={draft.connectionId ?? ""}
                  onChange={(event) => setDraft({ ...draft, connectionId: event.target.value || null })}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs outline-none focus:border-[var(--primary)]/50"
                >
                  <option value="">{localizeUi("ui.chat.dailyintentionsconfigmodal.defaultAgentConnection")}</option>
                  {connectionOptions.map((connection) => (
                    <option key={connection.id} value={connection.id}>
                      {connection.name} ({connection.model})
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1.5 text-xs font-medium">
                <span>{localizeUi("ui.chat.dailyintentionsconfigmodal.dailyCutoff")}</span>
                <select
                  aria-label={localizeUi("ui.chat.dailyintentionsconfigmodal.dailyIntentionsCutoffTime")}
                  value={draft.cutoffHour}
                  onChange={(event) => setDraft({ ...draft, cutoffHour: Number(event.target.value) })}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs outline-none focus:border-[var(--primary)]/50"
                >
                  {Array.from({ length: 24 }, (_, hour) => (
                    <option key={hour} value={hour}>
                      {localizeUi("ui.chat.chatsettingsdrawer.value100", { value1: String(hour).padStart(2, "0") })}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="mt-2 text-[0.625rem] leading-relaxed text-[var(--muted-foreground)]">
              {localizeUi("ui.chat.dailyintentionsconfigmodal.dailyIntentionsIsManualOnlyInThisVersionThe")}
            </p>
          </div>

          <div className="space-y-3">
            {draft.areas.map((area) => {
              const defaults = DEFAULT_DAILY_INTENTION_AREAS.find((candidate) => candidate.key === area.key)!;
              return (
                <section
                  key={area.key}
                  data-testid={`daily-intentions-config-area-${area.key}`}
                  className="rounded-lg border border-[var(--border)] bg-[var(--secondary)]/40 p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <label className="min-w-0 flex-1 space-y-1 text-[0.6875rem] font-medium">
                      <span>{localizeUi("ui.chat.dailyintentionsconfigmodal.heading")}</span>
                      <input
                        aria-label={localizeUi("ui.chat.dailyintentionsconfigmodal.value1IntentionHeading", {
                          value1: defaults.heading,
                        })}
                        value={area.heading}
                        maxLength={120}
                        onChange={(event) => patchArea(area.key, { heading: event.target.value })}
                        className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs outline-none focus:border-[var(--primary)]/50"
                      />
                    </label>
                    <label className="mt-4 inline-flex shrink-0 items-center gap-2 text-xs font-medium">
                      <input
                        type="checkbox"
                        aria-label={localizeUi("ui.chat.dailyintentionsconfigmodal.enableValue1Intentions", {
                          value1: defaults.heading,
                        })}
                        checked={area.enabled}
                        onChange={(event) => patchArea(area.key, { enabled: event.target.checked })}
                        className="accent-[var(--primary)]"
                      />
                      {localizeUi("ui.chat.mariediteasyviewer.toggleEnabled")}
                    </label>
                  </div>
                  <label className="mt-3 block space-y-1 text-[0.6875rem] font-medium">
                    <span>{localizeUi("ui.chat.dailyintentionsconfigmodal.areaPrompt")}</span>
                    <textarea
                      aria-label={localizeUi("ui.chat.dailyintentionsconfigmodal.value1IntentionPrompt", {
                        value1: defaults.heading,
                      })}
                      value={area.prompt}
                      onChange={(event) => patchArea(area.key, { prompt: event.target.value })}
                      className="min-h-36 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs leading-relaxed outline-none focus:border-[var(--primary)]/50"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => patchArea(area.key, { heading: defaults.heading, prompt: defaults.prompt })}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[0.625rem] font-medium text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
                  >
                    <RotateCcw size="0.7rem" /> {localizeUi("ui.chat.dailyintentionsconfigmodal.resetHeadingAndPrompt")}
                  </button>
                </section>
              );
            })}
          </div>

          <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-3">
            <button
              type="button"
              onClick={close}
              className="rounded-lg px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
            >
              {localizeUi("chat.delete.dialog.cancel")}
            </button>
            <button
              type="button"
              disabled={!dirty || update.isPending}
              onClick={() => void save()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-medium text-[var(--primary-foreground)] disabled:opacity-50"
            >
              {update.isPending ? <Loader2 size="0.75rem" className="animate-spin" /> : <Save size="0.75rem" />}
              {localizeUi("ui.chat.dailyintentionsconfigmodal.saveSettings")}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
