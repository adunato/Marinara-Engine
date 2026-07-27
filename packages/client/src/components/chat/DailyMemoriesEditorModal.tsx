import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Chat, DailyMemory, DailyMemoryDay } from "@marinara-engine/shared";
import { showConfirmDialog } from "../../lib/app-dialogs";
import { Modal } from "../ui/Modal";
import {
  useDailyMemories,
  useGenerateDailyMemoryDay,
  useSaveDailyMemoryDay,
} from "../../hooks/use-daily-memories";

type DraftMemory = Pick<DailyMemory, "id" | "memory" | "importance">;

function cloneDays(days: DailyMemoryDay[]): Record<string, DraftMemory[]> {
  return Object.fromEntries(
    days.map((day) => [
      day.date,
      day.memories.map(({ id, memory, importance }) => ({ id, memory, importance })),
    ]),
  );
}

export function DailyMemoriesEditorModal({
  chat,
  open,
  onClose,
}: {
  chat: Chat;
  open: boolean;
  onClose: () => void;
}) {
  const query = useDailyMemories(chat.id, open);
  const saveDay = useSaveDailyMemoryDay(chat.id);
  const generateDay = useGenerateDailyMemoryDay(chat.id);
  const [drafts, setDrafts] = useState<Record<string, DraftMemory[]>>({});
  const [snapshot, setSnapshot] = useState<Record<string, DraftMemory[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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
    <Modal open={open} onClose={() => void close()} title="Daily Memories" width="max-w-3xl" chatFloatingPanel>
      <div className="flex min-h-0 flex-1 flex-col" data-testid="daily-memories-editor">
        <div className="border-b border-[var(--border)] px-5 py-3 text-xs text-[var(--muted-foreground)]">
          Review memories by completed Conversation day. Importance ranges from 1 (low) to 5 (very important).
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
          {query.isLoading && <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">Loading memories…</p>}
          {query.isError && <p className="py-8 text-center text-sm text-red-400">Could not load daily memories.</p>}
          {query.data?.days.length === 0 && (
            <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">No completed Conversation days yet.</p>
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
                    {day.formed ? `${memories.length} ${memories.length === 1 ? "memory" : "memories"}` : "Not generated"}
                  </span>
                </button>
                {isOpen && (
                  <div className="space-y-3 border-t border-[var(--border)] p-4">
                    {memories.map((memory, index) => (
                      <div key={memory.id} className="grid gap-2 rounded-lg bg-[var(--background)]/60 p-3 sm:grid-cols-[1fr_7rem_auto]">
                        <textarea
                          aria-label={`Memory ${index + 1} for ${day.date}`}
                          value={memory.memory}
                          rows={3}
                          onChange={(event) =>
                            setDrafts((current) => ({
                              ...current,
                              [day.date]: memories.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, memory: event.target.value } : item,
                              ),
                            }))
                          }
                          className="resize-y rounded-lg bg-[var(--secondary)] px-3 py-2 text-sm ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                        />
                        <label className="space-y-1 text-xs text-[var(--muted-foreground)]">
                          <span>Importance</span>
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
                            className="w-full rounded-lg bg-[var(--secondary)] px-2 py-2 text-sm ring-1 ring-[var(--border)]"
                          >
                            {[1, 2, 3, 4, 5].map((score) => <option key={score} value={score}>{score}</option>)}
                          </select>
                        </label>
                        <button
                          type="button"
                          aria-label={`Delete memory ${index + 1} from ${day.date}`}
                          onClick={() => setDrafts((current) => ({ ...current, [day.date]: memories.filter((_, i) => i !== index) }))}
                          className="self-center rounded-lg p-2 text-red-400 hover:bg-red-500/10"
                        ><Trash2 size={16} /></button>
                      </div>
                    ))}
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setDrafts((current) => ({
                          ...current,
                          [day.date]: [...memories, { id: crypto.randomUUID(), memory: "", importance: 3 }],
                        }))}
                        className="flex items-center gap-1 rounded-lg px-3 py-2 text-xs hover:bg-[var(--accent)]"
                      ><Plus size={14} /> Add memory</button>
                      <button type="button" disabled={busy} onClick={() => void generate(day.date, day.formed)} className="flex items-center gap-1 rounded-lg px-3 py-2 text-xs hover:bg-[var(--accent)] disabled:opacity-50">
                        <RefreshCw size={14} /> {day.formed ? "Regenerate day" : "Generate day"}
                      </button>
                      {day.formed && <button type="button" disabled={busy} onClick={() => void deleteDay(day.date)} className="ml-auto flex items-center gap-1 rounded-lg px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-50"><Trash2 size={14} /> Delete all</button>}
                    </div>
                  </div>
                )}
              </section>
            );
          })}
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--border)] p-4">
          <button type="button" onClick={() => void close()} className="rounded-lg px-4 py-2 text-sm hover:bg-[var(--accent)]">Close</button>
          <button type="button" disabled={busy || dirtyDates.length === 0} onClick={() => void save()} className="flex items-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm text-[var(--primary-foreground)] disabled:opacity-50"><Save size={15} /> Save changes</button>
        </div>
      </div>
    </Modal>
  );
}
