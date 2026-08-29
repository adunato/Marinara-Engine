import { useState } from "react";
import { Brain, ChevronDown, ChevronRight, RotateCcw, Trash2 } from "lucide-react";
import { useTranslation as useUiTranslation } from "react-i18next";
import type { ConversationContextSourceRole } from "@marinara-engine/shared";
import {
  useConversationContextBriefing,
  useResetConversationContextBriefing,
  useResetConversationContextSourceRoles,
  useUpdateConversationContextSourceRoles,
} from "../../../hooks/use-chats";
import { ChatSettingsSection } from "../ChatSettingsSection";

export function ConversationContextBriefingSection({ chatId }: { chatId: string }) {
  const { t } = useUiTranslation();
  const query = useConversationContextBriefing(chatId);
  const updateRoles = useUpdateConversationContextSourceRoles();
  const resetBriefing = useResetConversationContextBriefing();
  const resetRoles = useResetConversationContextSourceRoles();
  const [showBriefing, setShowBriefing] = useState(false);
  const data = query.data;

  return (
    <ChatSettingsSection
      id="conversation-context-briefing"
      label={t("ui.chatSettings.contextBriefing.title")}
      icon={<Brain size="0.875rem" />}
      help={t("ui.chatSettings.contextBriefing.help")}
    >
      <div className="space-y-3">
        {query.isLoading && <div className="text-xs text-[var(--muted-foreground)]">{t("ui.chatSettings.contextBriefing.loading")}</div>}
        {query.isError && <div className="text-xs text-[var(--destructive)]">{t("ui.chatSettings.contextBriefing.loadError")}</div>}
        {data?.sources.map((source) => (
          <div key={source.key} className="rounded-lg bg-[var(--secondary)]/60 p-2.5 ring-1 ring-[var(--border)]">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-[var(--foreground)]">{source.label}</div>
                <div className="mt-0.5 text-[0.625rem] text-[var(--muted-foreground)]">{source.description}</div>
                {!source.available && (
                  <div className="mt-1 text-[0.625rem] text-[var(--destructive)]">
                    {source.unavailableReason || t("ui.chatSettings.contextBriefing.unavailable")}
                  </div>
                )}
              </div>
              <select
                value={source.role}
                disabled={!source.available || updateRoles.isPending}
                onChange={(event) =>
                  updateRoles.mutate({
                    chatId,
                    roles: { [source.key]: event.target.value as ConversationContextSourceRole },
                  })
                }
                className="mari-preset-native-select rounded-lg bg-[var(--background)] px-2 py-1.5 pr-7 text-[0.6875rem] outline-none ring-1 ring-[var(--border)] disabled:opacity-50"
              >
                <option value="always_include">{t("ui.chatSettings.contextBriefing.alwaysInclude")}</option>
                <option value="agent_curated">{t("ui.chatSettings.contextBriefing.agentCurated")}</option>
                <option value="always_exclude" disabled={source.key === "recentExchange"}>
                  {t("ui.chatSettings.contextBriefing.alwaysExclude")}
                </option>
              </select>
            </div>
          </div>
        ))}

        <div className="flex flex-wrap gap-2">
          <button type="button" className="mari-chrome-control mari-chrome-control--small px-2.5 py-1.5 text-[0.6875rem]" onClick={() => resetRoles.mutate(chatId)}>
            <RotateCcw size="0.6875rem" /> {t("ui.chatSettings.contextBriefing.resetRoles")}
          </button>
          <button type="button" className="mari-chrome-control mari-chrome-control--small px-2.5 py-1.5 text-[0.6875rem]" onClick={() => resetBriefing.mutate(chatId)}>
            <Trash2 size="0.6875rem" /> {t("ui.chatSettings.contextBriefing.resetBriefing")}
          </button>
        </div>

        <button
          type="button"
          onClick={() => setShowBriefing((value) => !value)}
          className="flex w-full items-center gap-2 rounded-lg bg-[var(--secondary)]/60 px-3 py-2 text-left text-xs ring-1 ring-[var(--border)]"
        >
          {showBriefing ? <ChevronDown size="0.75rem" /> : <ChevronRight size="0.75rem" />}
          {t("ui.chatSettings.contextBriefing.viewBriefing")}
          {data?.state && <span className="ml-auto text-[0.625rem] text-[var(--muted-foreground)]">{t("ui.characters.charactereditor.v")}{data.state.revision}</span>}
        </button>
        {showBriefing && (
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--background)] p-3 text-[0.6875rem] ring-1 ring-[var(--border)]">
            {data?.briefing || t("ui.chatSettings.contextBriefing.empty")}
          </pre>
        )}
      </div>
    </ChatSettingsSection>
  );
}
