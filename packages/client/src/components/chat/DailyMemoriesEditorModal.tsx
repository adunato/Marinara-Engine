import { useEffect, useMemo, useRef, useState, type WheelEvent } from "react";
import { ChevronDown, ChevronRight, Loader2, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Chat, DailyMemory, DailyMemoryDay } from "@marinara-engine/shared";
import { showConfirmDialog } from "../../lib/app-dialogs";
import { Modal } from "../ui/Modal";
import { useDailyMemories, useGenerateDailyMemoryDay, useSaveDailyMemoryDay } from "../../hooks/use-daily-memories";

type DraftMemory = Pick<DailyMemory, "id" | "memory" | "importance">;

function cloneDays(days: DailyMemoryDay[]): Record<string, DraftMemory[]> {
  return Object.fromEntries(
    days.map((day) => [day.date, day.memories.map(({ id, memory, importance }) => ({ id, memory, importance }))]),
  );
}

export function DailyMemoriesEditorModal({ chat, open, onClose }: { chat: Chat; open: boolean; onClose: () => void }) {
  const query = useDailyMemories(chat.id, open);
  const saveDay = useSaveDailyMemoryDay(chat.id);
  const generateDay = useGenerateDailyMemoryDay(chat.id);
  const [drafts, setDrafts] = useState<Record<string, DraftMemory[]>>({});
  const [snapshot, setSnapshot] = useState<Record<string, DraftMemory[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const scrollSurfaceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !query.data) return;
    const next = cloneDays(query.data.days);
    setDrafts(next);
    setSnapshot(next);
  }, [open, query.data]);

  const dirtyDates = useMemo(
    () => Object.keys(drafts).filter((date) => JSON.stringify(drafts[date]) !== JSON.stringify(snapshot[date])),
    [drafts, snapshot],
  );
  const busy = saveDay.isPending || generateDay.isPending;
  const generatingDate = generateDay.isPending ? generateDay.variables : null;

  const scrollDialogFromMemory = (event: WheelEvent<HTMLTextAreaElement>) => {
    const scrollSurface = scrollSurfaceRef.current;
    if (!scrollSurface || scrollSurface.scrollHeight <= scrollSurface.clientHeight) return;
    event.preventDefault();
    const delta =
      event.deltaMode === 1
        ? event.deltaY * 16
        : event.deltaMode === 2
          ? event.deltaY * scrollSurface.clientHeight
          : event.deltaY;
    scrollSurface.scrollTop += delta;
  };

  const close = async () => {
    if (
      dirtyDates.length > 0 &&
      !(await showConfirmDialog({
        title: "Discard daily memory edits?",
        message: "Your unsaved memory changes will be lost.",
        confirmLabel: "Discard",
      }))
    ) {
      return;
    }
    onClose();
  };

  const save = async () => {
    try {
      for (const date of dirtyDates) {
        await saveDay.mutateAsync({
          date,
          memories: (drafts[date] ?? []).filter((memory) => memory.memory.trim()),
        });
      }
      await query.refetch();
      toast.success("Daily memories saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save daily memories");
    }
  };

  const generate = async (date: string, formed: boolean) => {
    if (formed) {
      const confirmed = await showConfirmDialog({
        title: `Regenerate memories for ${date}?`,
        message: "This replaces every memory currently saved for the day.",
        confirmLabel: "Regenerate",
      });
      if (!confirmed) return;
    }
    try {
      await generateDay.mutateAsync(date);
      await query.refetch();
      toast.success(formed ? "Daily memories regenerated" : "Daily memories generated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not generate daily memories");
    }
  };

  const deleteDay = async (date: string) => {
    const confirmed = await showConfirmDialog({
      title: `Delete all memories for ${date}?`,
      message: "The day remains available and can be generated again later.",
      confirmLabel: "Delete all",
    });
    if (!confirmed) return;
    try {
      await saveDay.mutateAsync({ date, memories: [] });
      await query.refetch();
      toast.success("Day memories deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete day memories");
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => void close()}
      title="Daily Memories"
      width="max-w-5xl"
      contentRef={scrollSurfaceRef}
      contentTestId="daily-memories-editor-scroll"
      chatFloatingPanel
    >
      <div data-testid="daily-memories-editor">
        <div className="border-b border-[var(--border)] px-5 py-3 text-xs text-[var(--muted-foreground)]">
          Review memories by completed Conversation day. Importance ranges from 1 (low) to 5 (very important).
        </div>
        <div className="space-y-2 p-4">
          {query.isLoading && (
            <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">Loading memories…</p>
          )}
          {query.isError && <p className="py-8 text-center text-sm text-red-400">Could not load daily memories.</p>}
          {query.data?.days.length === 0 && (
            <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">
              No completed Conversation days yet.
            </p>
          )}
          {query.data?.days.map((day) => {
            const isOpen = expanded.has(day.date);
            const memories = drafts[day.date] ?? [];
            return (
              <section key={day.date} className="rounded-xl border border-[var(--border)] bg-[var(--secondary)]/35">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-4 py-3 text-left"
                  onClick={() =>
                    setExpanded((current) => {
                      const next = new Set(current);
                      if (next.has(day.date)) next.delete(day.date);
                      else next.add(day.date);
                      return next;
                    })
                  }
                  aria-expanded={isOpen}
                >
                  {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <span className="font-medium">{day.date}</span>
                  <span className="ml-auto text-xs text-[var(--muted-foreground)]">
                    {day.formed
                      ? `${memories.length} ${memories.length === 1 ? "memory" : "memories"}`
                      : "Not generated"}
                  </span>
                </button>
                {isOpen && (
                  <div className="space-y-3 border-t border-[var(--border)] p-3 sm:p-4">
                    {memories.map((memory, index) => (
                      <div
                        key={memory.id}
                        className="grid items-end gap-3 rounded-xl bg-[var(--background)]/60 p-3 sm:grid-cols-[minmax(0,1fr)_5rem_2.25rem]"
                      >
                        <textarea
                          aria-label={`Memory ${index + 1} for ${day.date}`}
                          value={memory.memory}
                          rows={2}
                          onWheel={scrollDialogFromMemory}
                          onChange={(event) =>
                            setDrafts((current) => ({
                              ...current,
                              [day.date]: memories.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, memory: event.target.value } : item,
                              ),
                            }))
                          }
                          className="min-h-[4.25rem] resize-y rounded-lg bg-[var(--secondary)] px-3 py-2 text-sm leading-relaxed ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                        />
                        <label className="space-y-1 text-center text-[0.625rem] text-[var(--muted-foreground)]">
                          <span className="block">Importance</span>
                          <select
                            aria-label={`Importance for memory ${index + 1} on ${day.date}`}
                            value={memory.importance}
                            onChange={(event) =>
                              setDrafts((current) => ({
                                ...current,
                                [day.date]: memories.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, importance: Number(event.target.value) } : item,
                                ),
                              }))
                            }
                            className="w-full rounded-lg bg-[var(--secondary)] px-1.5 py-2 text-center text-sm text-[var(--foreground)] ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                          >
                            {[1, 2, 3, 4, 5].map((score) => (
                              <option
                                key={score}
                                value={score}
                                className="bg-[var(--popover)] text-[var(--popover-foreground)]"
                              >
                                {score}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="button"
                          aria-label={`Delete memory ${index + 1} from ${day.date}`}
                          onClick={() =>
                            setDrafts((current) => ({ ...current, [day.date]: memories.filter((_, i) => i !== index) }))
                          }
                          className="flex h-9 w-9 items-center justify-center rounded-lg text-red-400 hover:bg-red-500/10"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setDrafts((current) => ({
                            ...current,
                            [day.date]: [...memories, { id: crypto.randomUUID(), memory: "", importance: 3 }],
                          }))
                        }
                        className="flex items-center gap-1 rounded-lg px-3 py-2 text-xs hover:bg-[var(--accent)]"
                      >
                        <Plus size={14} /> Add memory
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        aria-busy={generatingDate === day.date}
                        onClick={() => void generate(day.date, day.formed)}
                        className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs hover:bg-[var(--accent)] disabled:cursor-wait disabled:opacity-60"
                      >
                        {generatingDate === day.date ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <RefreshCw size={14} />
                        )}
                        {generatingDate === day.date
                          ? day.formed
                            ? "Regenerating..."
                            : "Generating..."
                          : day.formed
                            ? "Regenerate day"
                            : "Generate memories"}
                      </button>
                      {day.formed && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void deleteDay(day.date)}
                          className="ml-auto flex items-center gap-1 rounded-lg px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                        >
                          <Trash2 size={14} /> Delete all
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </section>
            );
          })}
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--border)] p-4">
          <button
            type="button"
            onClick={() => void close()}
            className="rounded-lg px-4 py-2 text-sm hover:bg-[var(--accent)]"
          >
            Close
          </button>
          <button
            type="button"
            disabled={busy || dirtyDates.length === 0}
            onClick={() => void save()}
            className="flex items-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm text-[var(--primary-foreground)] disabled:opacity-50"
          >
            <Save size={15} /> Save changes
          </button>
        </div>
      </div>
    </Modal>
  );
}
