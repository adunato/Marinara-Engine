import { type DailyIntentionAreaKey } from "@marinara-engine/shared";
import { Loader2, Play, Save } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  useDailyIntentions,
  useGenerateDailyIntention,
  useRunAllDailyIntentions,
  useSaveDailyIntentionsOutputs,
} from "../../hooks/use-daily-intentions";
import { Modal } from "../ui/Modal";

interface DailyIntentionsEditorModalProps {
  chatId: string;
  open: boolean;
  onClose: () => void;
}

type AreaStatus = "idle" | "running" | "success" | "error";

export function DailyIntentionsEditorModal({ chatId, open, onClose }: DailyIntentionsEditorModalProps) {
  const query = useDailyIntentions(chatId, open);
  const saveMutation = useSaveDailyIntentionsOutputs(chatId);
  const generateMutation = useGenerateDailyIntention(chatId);
  const runAllMutation = useRunAllDailyIntentions(chatId);
  const [drafts, setDrafts] = useState<Partial<Record<DailyIntentionAreaKey, string>>>({});
  const [statuses, setStatuses] = useState<Partial<Record<DailyIntentionAreaKey, AreaStatus>>>({});
  const [errors, setErrors] = useState<Partial<Record<DailyIntentionAreaKey, string>>>({});
  const initializedOpenRef = useRef(false);

  useEffect(() => {
    if (!open) {
      initializedOpenRef.current = false;
      return;
    }
    if (!query.data || initializedOpenRef.current) return;
    initializedOpenRef.current = true;
    setDrafts(
      Object.fromEntries(Object.entries(query.data.outputs).map(([key, output]) => [key, output?.content ?? ""])),
    );
    setStatuses({});
    setErrors({});
  }, [open, query.data]);

  const enabledAreas = useMemo(
    () => query.data?.settings.areas.filter((area) => area.enabled) ?? [],
    [query.data?.settings.areas],
  );
  const dirtyKeys = useMemo(
    () =>
      enabledAreas
        .filter((area) => (drafts[area.key] ?? "") !== (query.data?.outputs[area.key]?.content ?? ""))
        .map((area) => area.key),
    [drafts, enabledAreas, query.data?.outputs],
  );
  const busy = generateMutation.isPending || runAllMutation.isPending || saveMutation.isPending;

  const close = () => {
    if (dirtyKeys.length > 0 && !window.confirm("Discard Daily Intentions edits?")) return;
    onClose();
  };

  const save = async () => {
    if (dirtyKeys.length === 0) return;
    try {
      await saveMutation.mutateAsync(Object.fromEntries(dirtyKeys.map((key) => [key, drafts[key] ?? ""])));
      toast.success("Daily Intentions saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save Daily Intentions");
    }
  };

  const generateArea = async (key: DailyIntentionAreaKey) => {
    if (dirtyKeys.includes(key) && !window.confirm("Replace the unsaved text in this area?")) return;
    setStatuses((current) => ({ ...current, [key]: "running" }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    try {
      const result = await generateMutation.mutateAsync(key);
      setDrafts((current) => ({ ...current, [key]: result.output.content }));
      setStatuses((current) => ({ ...current, [key]: "success" }));
    } catch (error) {
      setStatuses((current) => ({ ...current, [key]: "error" }));
      setErrors((current) => ({ ...current, [key]: error instanceof Error ? error.message : "Generation failed" }));
    }
  };

  const runAll = async () => {
    if (dirtyKeys.length > 0 && !window.confirm("Run All will replace unsaved text as each area succeeds. Continue?")) {
      return;
    }
    setStatuses(Object.fromEntries(enabledAreas.map((area) => [area.key, "idle"])));
    setErrors({});
    try {
      await runAllMutation.mutateAsync((event) => {
        if (event.type === "area_started") {
          setStatuses((current) => ({ ...current, [event.key]: "running" }));
        } else if (event.type === "area_succeeded") {
          setDrafts((current) => ({ ...current, [event.key]: event.output.content }));
          setStatuses((current) => ({ ...current, [event.key]: "success" }));
        } else if (event.type === "area_failed") {
          setStatuses((current) => ({ ...current, [event.key]: "error" }));
          setErrors((current) => ({ ...current, [event.key]: event.error }));
        } else if (event.type === "error") {
          toast.error(event.error);
        }
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not run Daily Intentions");
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Daily Intentions"
      width="max-w-5xl"
      contentTestId="daily-intentions-editor-scroll"
      chatFloatingPanel
      closeDisabled={busy}
    >
      {query.isLoading ? (
        <div className="flex min-h-40 items-center justify-center">
          <Loader2 className="animate-spin text-[var(--primary)]" size="1.25rem" />
        </div>
      ) : query.isError || !query.data ? (
        <p className="py-8 text-center text-sm text-red-400">Could not load Daily Intentions.</p>
      ) : !query.data.eligible ? (
        <p className="rounded-lg bg-amber-400/10 p-4 text-sm text-amber-300">{query.data.eligibilityError}</p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-2xl text-xs leading-relaxed text-[var(--muted-foreground)]">
              Current first-person intentions for {query.data.characterName ?? "this character"}. Successful runs replace
              one area immediately; failed areas keep their previous text.
            </p>
            <button
              type="button"
              data-testid="run-all-daily-intentions"
              disabled={busy || enabledAreas.length === 0}
              onClick={() => void runAll()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-medium text-[var(--primary-foreground)] disabled:opacity-50"
            >
              {runAllMutation.isPending ? <Loader2 size="0.8rem" className="animate-spin" /> : <Play size="0.8rem" />}
              {runAllMutation.isPending ? "Running areas..." : "Run/Re-run All"}
            </button>
          </div>

          <div className="space-y-3">
            {enabledAreas.map((area) => {
              const status = statuses[area.key] ?? "idle";
              return (
                <section
                  key={area.key}
                  data-testid={`daily-intentions-output-${area.key}`}
                  className="rounded-lg border border-[var(--border)] bg-[var(--secondary)]/40 p-3"
                >
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold">{area.heading}</h3>
                      {status === "success" && <p className="text-[0.625rem] text-emerald-400">Updated successfully</p>}
                      {status === "error" && <p className="text-[0.625rem] text-red-400">{errors[area.key]}</p>}
                    </div>
                    <button
                      type="button"
                      aria-label={`Run ${area.heading} intention`}
                      disabled={busy}
                      onClick={() => void generateArea(area.key)}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 text-[0.6875rem] font-medium hover:bg-[var(--accent)] disabled:opacity-50"
                    >
                      {status === "running" ? <Loader2 size="0.75rem" className="animate-spin" /> : <Play size="0.75rem" />}
                      {status === "running" ? "Running..." : "Run/Re-run"}
                    </button>
                  </div>
                  <textarea
                    aria-label={`${area.heading} current intention`}
                    value={drafts[area.key] ?? ""}
                    disabled={status === "running"}
                    placeholder="No current intention. Run this area or write one manually."
                    onChange={(event) => setDrafts((current) => ({ ...current, [area.key]: event.target.value }))}
                    className="min-h-28 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs leading-relaxed outline-none focus:border-[var(--primary)]/50 disabled:opacity-60"
                  />
                </section>
              );
            })}
          </div>

          <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-3">
            <button
              type="button"
              disabled={busy}
              onClick={close}
              className="rounded-lg px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] hover:bg-[var(--accent)] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || dirtyKeys.length === 0}
              onClick={() => void save()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-medium text-[var(--primary-foreground)] disabled:opacity-50"
            >
              {saveMutation.isPending ? <Loader2 size="0.75rem" className="animate-spin" /> : <Save size="0.75rem" />}
              Save edits
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
