import { useMemo, useState } from "react";
import { Check, Loader2, MessageSquare, Search } from "lucide-react";
import { toast } from "sonner";
import type { Chat, ChatMode } from "@marinara-engine/shared";

import { useChatContextSources, useChats, useReplaceChatContextSources } from "../../hooks/use-chats";
import { getConnectedChatDisplayName } from "../../lib/chat-display";
import { cn } from "../../lib/utils";
import { useTranslation as useUiTranslation } from "react-i18next";

type SourceModeFilter = "all" | Extract<ChatMode, "conversation" | "roleplay" | "game">;

const MODE_LABELS: Record<Exclude<SourceModeFilter, "all">, string> = {
  conversation: "Conversation",
  roleplay: "Roleplay",
  game: "Game",
};

export function ChatContextSourcesPicker({ chatId }: { chatId: string }) {
  const { t: localizeUi } = useUiTranslation();
  const { data: chats = [] } = useChats({ refetchOnMount: false });
  const { data: sources = [], isLoading } = useChatContextSources(chatId);
  const replaceSources = useReplaceChatContextSources();
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<SourceModeFilter>("all");

  const selectedIds = useMemo(() => new Set(sources.map((source) => source.sourceChatId)), [sources]);
  const eligibleChats = useMemo(
    () =>
      (chats as Chat[])
        .filter(
          (chat) =>
            chat.id !== chatId && (chat.mode === "conversation" || chat.mode === "roleplay" || chat.mode === "game"),
        )
        .filter((chat) => mode === "all" || chat.mode === mode)
        .filter((chat) => getConnectedChatDisplayName(chat).toLowerCase().includes(search.trim().toLowerCase())),
    [chatId, chats, mode, search],
  );

  const toggleSource = async (sourceChatId: string) => {
    const nextIds = selectedIds.has(sourceChatId)
      ? sources.map((source) => source.sourceChatId).filter((id) => id !== sourceChatId)
      : [...sources.map((source) => source.sourceChatId), sourceChatId];
    try {
      await replaceSources.mutateAsync({ chatId, sourceChatIds: nextIds });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : localizeUi("ui.chat.chatcontextsourcespicker.couldNotUpdateSourceChats"),
      );
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-[0.6875rem] leading-relaxed text-[var(--muted-foreground)]">
        {localizeUi("ui.chat.chatcontextsourcespicker.selectedChatsProvideReadOnlySummariesAndRecentMessages")}
      </p>
      <div className="overflow-hidden rounded-lg bg-[var(--card)] ring-1 ring-[var(--border)]">
        <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
          <Search size="0.75rem" className="shrink-0 text-[var(--muted-foreground)]" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={localizeUi("ui.chat.chatcontextsourcespicker.searchChats")}
            className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-[var(--muted-foreground)]"
          />
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as SourceModeFilter)}
            className="max-w-28 bg-transparent text-[0.6875rem] text-[var(--muted-foreground)] outline-none"
            aria-label={localizeUi("ui.chat.chatcontextsourcespicker.filterSourceChatsByMode")}
          >
            <option value="all">{localizeUi("ui.chat.chatsettingsdrawer.spriteLayoutAll")}</option>
            <option value="conversation">{localizeUi("settings.modes.conversations")}</option>
            <option value="roleplay">{localizeUi("ui.noodle.noodlehome.roleplays")}</option>
            <option value="game">{localizeUi("ui.noodle.noodlehome.games")}</option>
          </select>
        </div>
        <div className="max-h-52 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 px-3 py-6 text-xs text-[var(--muted-foreground)]">
              <Loader2 size="0.75rem" className="animate-spin" />
              {localizeUi("ui.chat.chatcontextsourcespicker.loadingChats")}
            </div>
          ) : (
            eligibleChats.map((sourceChat) => {
              const selected = selectedIds.has(sourceChat.id);
              return (
                <button
                  key={sourceChat.id}
                  type="button"
                  onClick={() => void toggleSource(sourceChat.id)}
                  disabled={replaceSources.isPending}
                  className={cn(
                    "flex w-full items-center gap-2.5 border-b border-[var(--border)]/60 px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-[var(--accent)] disabled:opacity-60",
                    selected && "bg-[var(--primary)]/10",
                  )}
                >
                  <MessageSquare size="0.75rem" className="shrink-0 text-[var(--muted-foreground)]" />
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-xs">{getConnectedChatDisplayName(sourceChat)}</span>
                    <span className="block text-[0.625rem] text-[var(--muted-foreground)]">
                      {MODE_LABELS[sourceChat.mode as Exclude<SourceModeFilter, "all">]}
                    </span>
                  </div>
                  <span
                    className={cn(
                      "flex h-4 w-4 items-center justify-center rounded border",
                      selected
                        ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]"
                        : "border-[var(--border)]",
                    )}
                  >
                    {selected && <Check size="0.625rem" />}
                  </span>
                </button>
              );
            })
          )}
          {!isLoading && eligibleChats.length === 0 && (
            <p className="px-3 py-5 text-center text-[0.6875rem] text-[var(--muted-foreground)]">
              {localizeUi("ui.chat.chatcontextsourcespicker.noMatchingChats")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
