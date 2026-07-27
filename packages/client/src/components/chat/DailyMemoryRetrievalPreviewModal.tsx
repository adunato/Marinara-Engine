import { useMemo } from "react";
import { Brain, Loader2, RefreshCw } from "lucide-react";
import type { DailyMemoryRetrievalPreviewMemory } from "@marinara-engine/shared";
import { useDailyMemoryRetrievalPreview } from "../../hooks/use-daily-memories";
import { Modal } from "../ui/Modal";

export function DailyMemoryRetrievalPreviewModal({
  chatId,
  open,
  onClose,
}: {
  chatId: string;
  open: boolean;
  onClose: () => void;
}) {
  const preview = useDailyMemoryRetrievalPreview(chatId, open);
  const grouped = useMemo(() => {
    const result = new Map<string, DailyMemoryRetrievalPreviewMemory[]>();
    for (const memory of preview.data?.memories ?? []) {
      const memories = result.get(memory.date) ?? [];
      memories.push(memory);
      result.set(memory.date, memories);
    }
    return [...result.entries()].sort(([leftDate], [rightDate]) => {
      const [leftDay, leftMonth, leftYear] = leftDate.split(".").map(Number);
      const [rightDay, rightMonth, rightYear] = rightDate.split(".").map(Number);
      const leftTime = Date.UTC(leftYear ?? 0, (leftMonth ?? 1) - 1, leftDay ?? 1);
      const rightTime = Date.UTC(rightYear ?? 0, (rightMonth ?? 1) - 1, rightDay ?? 1);
      return leftTime - rightTime || leftDate.localeCompare(rightDate);
    });
  }, [preview.data?.memories]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Current Daily Memories"
      width="max-w-3xl"
      contentTestId="daily-memory-preview-scroll"
      chatFloatingPanel
    >
      <div data-testid="daily-memory-retrieval-preview">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-3">
          <p className="max-w-2xl text-xs leading-relaxed text-[var(--muted-foreground)]">
            These are the daily memories that would be injected for this Conversation using the saved retrieval
            settings. Previewing does not change any memories.
          </p>
          <button
            type="button"
            onClick={() => void preview.refetch()}
            disabled={preview.isFetching}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:opacity-50"
          >
            <RefreshCw size="0.75rem" className={preview.isFetching ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
        <div className="space-y-4 p-4">
          {preview.isLoading && (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-[var(--muted-foreground)]">
              <Loader2 size="1rem" className="animate-spin" /> Ranking current memories…
            </div>
          )}
          {preview.isError && (
            <div className="rounded-xl border border-[var(--destructive)]/30 bg-[var(--destructive)]/10 px-4 py-3 text-sm text-[var(--destructive)]">
              {preview.error instanceof Error
                ? preview.error.message
                : "Could not preview the current memory extraction."}
            </div>
          )}
          {preview.data && (
            <section className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                <div className="flex items-center gap-2 px-1">
                  <Brain size="0.875rem" className="text-[var(--primary)]" />
                  <h3 className="text-xs font-semibold text-[var(--foreground)]">
                    Daily memories that would be injected ({preview.data.memories.length})
                  </h3>
                </div>
                <span className="text-[0.625rem] text-[var(--muted-foreground)]">
                  Based on {preview.data.messagesConsidered} recent message
                  {preview.data.messagesConsidered === 1 ? "" : "s"}
                </span>
              </div>
              {grouped.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--muted-foreground)]">
                  No daily memories match the current Conversation context.
                </div>
              ) : (
                grouped.map(([date, memories]) => (
                  <div
                    key={date}
                    data-testid="daily-memory-preview-day"
                    data-date={date}
                    className="overflow-hidden rounded-xl border border-[var(--border)]"
                  >
                    <div className="bg-[var(--secondary)]/50 px-3 py-2 text-xs font-semibold text-[var(--foreground)]">
                      {date}
                    </div>
                    <div className="divide-y divide-[var(--border)]">
                      {memories.map((memory) => (
                        <div
                          key={memory.id}
                          className="grid gap-2 bg-[var(--background)] px-3 py-3 sm:grid-cols-[1fr_auto]"
                        >
                          <p className="text-xs leading-relaxed text-[var(--foreground)]">{memory.memory}</p>
                          <div className="flex items-center gap-1.5 text-[0.625rem] text-[var(--muted-foreground)] sm:justify-end">
                            <span className="rounded-full bg-[var(--secondary)] px-2 py-1">
                              Importance {memory.importance}/5
                            </span>
                            <span className="rounded-full bg-[var(--primary)]/10 px-2 py-1 text-[var(--primary)]">
                              Rank {Math.round(memory.rankingScore * 100)}%
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </section>
          )}
        </div>
      </div>
    </Modal>
  );
}
