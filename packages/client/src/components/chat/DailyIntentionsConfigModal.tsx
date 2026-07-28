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

interface DailyIntentionsConfigModalProps {
  chatId: string;
  open: boolean;
  onClose: () => void;
}

export function DailyIntentionsConfigModal({ chatId, open, onClose }: DailyIntentionsConfigModalProps) {
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
    if (dirty && !window.confirm("Discard Daily Intentions configuration changes?")) return;
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
      toast.success("Daily Intentions settings saved");
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save Daily Intentions settings");
    }
  };

  return (
    <Modal open={open} onClose={close} title="Configure Daily Intentions" width="max-w-4xl" chatFloatingPanel>
      {query.isLoading || !draft ? (
        <div className="flex min-h-40 items-center justify-center">
          <Loader2 className="animate-spin text-[var(--primary)]" size="1.25rem" />
        </div>
      ) : query.isError ? (
        <p className="py-8 text-center text-sm text-red-400">Could not load Daily Intentions configuration.</p>
      ) : (
        <div className="space-y-4" data-testid="daily-intentions-config">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--secondary)]/60 p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5 text-xs font-medium">
                <span>Generation connection</span>
                <select
                  aria-label="Daily Intentions generation connection"
                  value={draft.connectionId ?? ""}
                  onChange={(event) => setDraft({ ...draft, connectionId: event.target.value || null })}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs outline-none focus:border-[var(--primary)]/50"
                >
                  <option value="">Default agent connection</option>
                  {connectionOptions.map((connection) => (
                    <option key={connection.id} value={connection.id}>
                      {connection.name} ({connection.model})
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1.5 text-xs font-medium">
                <span>Daily cutoff</span>
                <select
                  aria-label="Daily Intentions cutoff time"
                  value={draft.cutoffHour}
                  onChange={(event) => setDraft({ ...draft, cutoffHour: Number(event.target.value) })}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs outline-none focus:border-[var(--primary)]/50"
                >
                  {Array.from({ length: 24 }, (_, hour) => (
                    <option key={hour} value={hour}>{`${String(hour).padStart(2, "0")}:00`}</option>
                  ))}
                </select>
              </label>
            </div>
            <p className="mt-2 text-[0.625rem] leading-relaxed text-[var(--muted-foreground)]">
              Daily Intentions is manual-only in this version. The cutoff is saved for future scheduling but does not
              trigger, expire, or gate a run.
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
                      <span>Heading</span>
                      <input
                        aria-label={`${defaults.heading} intention heading`}
                        value={area.heading}
                        maxLength={120}
                        onChange={(event) => patchArea(area.key, { heading: event.target.value })}
                        className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs outline-none focus:border-[var(--primary)]/50"
                      />
                    </label>
                    <label className="mt-4 inline-flex shrink-0 items-center gap-2 text-xs font-medium">
                      <input
                        type="checkbox"
                        aria-label={`Enable ${defaults.heading} intentions`}
                        checked={area.enabled}
                        onChange={(event) => patchArea(area.key, { enabled: event.target.checked })}
                        className="accent-[var(--primary)]"
                      />
                      Enabled
                    </label>
                  </div>
                  <label className="mt-3 block space-y-1 text-[0.6875rem] font-medium">
                    <span>Area prompt</span>
                    <textarea
                      aria-label={`${defaults.heading} intention prompt`}
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
                    <RotateCcw size="0.7rem" /> Reset heading and prompt
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
              Cancel
            </button>
            <button
              type="button"
              disabled={!dirty || update.isPending}
              onClick={() => void save()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-medium text-[var(--primary-foreground)] disabled:opacity-50"
            >
              {update.isPending ? <Loader2 size="0.75rem" className="animate-spin" /> : <Save size="0.75rem" />}
              Save settings
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
