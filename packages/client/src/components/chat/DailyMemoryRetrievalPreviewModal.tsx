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
    return [...result.entries()];
  }, [preview.data?.memories]);

  return (
    <Modal open={open} onClose={onClose} title="Current Memory Extraction Preview" width="max-w-3xl" chatFloatingPanel>
      <div className="flex min-h-0 flex-1 flex-col" data-testid="daily-memory-retrieval-preview">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-3">
          <p className="max-w-2xl text-xs leading-relaxed text-[var(--muted-foreground)]">
            This is the current vector-ranked memory extraction for this Conversation. It uses the saved retrieval
            settings and does not change any memories.
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
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
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
            <>
              <section className="rounded-xl border border-[var(--border)] bg-[var(--secondary)]/30 p-3">
                <h3 className="text-xs font-semibold text-[var(--foreground)]">
                  Context used ({preview.data.queryMessages.length} of up to {preview.data.retrievalMessageCount}{" "}
                  messages)
                </h3>
                {preview.data.queryMessages.length > 0 ? (
                  <div className="mt-2 space-y-1.5">
                    {preview.data.queryMessages.map((message, index) => (
                      <p
                        key={`${index}-${message}`}
                        className="rounded-lg bg-[var(--background)] px-3 py-2 text-xs leading-relaxed text-[var(--muted-foreground)]"
                      >
                        {message}
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-[var(--muted-foreground)]">No eligible messages are available.</p>
                )}
              </section>

              <section className="space-y-2">
                <div className="flex items-center gap-2 px-1">
                  <Brain size="0.875rem" className="text-[var(--primary)]" />
                  <h3 className="text-xs font-semibold text-[var(--foreground)]">
                    Memories that would be injected ({preview.data.memories.length})
                  </h3>
                </div>
                {grouped.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--muted-foreground)]">
                    No stored memories match the current Conversation context.
                  </div>
                ) : (
                  grouped.map(([date, memories]) => (
                    <div key={date} className="overflow-hidden rounded-xl border border-[var(--border)]">
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
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
