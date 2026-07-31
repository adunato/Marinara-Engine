type DailyMemoryDayReplacedListener = (chatId: string, date: string) => void | Promise<void>;

const listeners = new Set<DailyMemoryDayReplacedListener>();

export function onDailyMemoryDayReplaced(listener: DailyMemoryDayReplacedListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitDailyMemoryDayReplaced(chatId: string, date: string): void {
  for (const listener of listeners) void Promise.resolve(listener(chatId, date)).catch(() => undefined);
}
