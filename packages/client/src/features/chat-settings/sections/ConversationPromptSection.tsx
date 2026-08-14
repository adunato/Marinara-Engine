import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, GitBranch, Pencil, RotateCcw, Sliders, Trash2 } from "lucide-react";
import {
  CONVERSATION_CURATOR_OUTPUT_TOKENS,
  DEFAULT_CONVERSATION_BRIEFING_PROMPT,
  DEFAULT_CONVERSATION_PROMPT,
  DEFAULT_CONVERSATION_WRITER_PROMPT,
  type ConversationGenerationPipeline,
} from "@marinara-engine/shared";
import { ExpandedTextarea } from "../../../components/ui/ExpandedTextarea";
import { MacroTextarea } from "../../../components/ui/MacroTextarea";
import { ChatSettingsSection } from "../ChatSettingsSection";
import { useTranslation as useUiTranslation } from "react-i18next";

interface PromptPresetOption {
  id: string;
  name: string;
  conversationPrompt?: string;
  conversationBriefingPrompt?: string;
  conversationWriterPrompt?: string;
}

interface ConnectionOption {
  id: string;
  name: string;
  model?: string;
}

interface ConversationPromptSectionProps {
  chatId: string;
  customPrompt: string;
  promptPresetId: string | null;
  promptPresets: PromptPresetOption[];
  selectedPresetPrompt: string;
  selectedPresetBriefingPrompt: string;
  selectedPresetWriterPrompt: string;
  pipeline: ConversationGenerationPipeline;
  curatorConnectionId: string;
  curatorMaxOutputTokens: number;
  customBriefingPrompt: string;
  customWriterPrompt: string;
  connections: ConnectionOption[];
  onCustomPromptChange: (chatId: string, customPrompt: string | null) => void;
  onPipelineChange: (pipeline: ConversationGenerationPipeline) => void;
  onCuratorConnectionChange: (connectionId: string | null) => void;
  onCuratorMaxOutputTokensChange: (maxTokens: number) => void;
  onCustomBriefingPromptChange: (prompt: string | null) => void;
  onCustomWriterPromptChange: (prompt: string | null) => void;
  onPromptPresetChange: (presetId: string | null) => void;
}

export function ConversationPromptSection({
  chatId,
  customPrompt,
  promptPresetId,
  promptPresets,
  selectedPresetPrompt,
  selectedPresetBriefingPrompt,
  selectedPresetWriterPrompt,
  pipeline,
  curatorConnectionId,
  curatorMaxOutputTokens,
  customBriefingPrompt,
  customWriterPrompt,
  connections,
  onCustomPromptChange,
  onPipelineChange,
  onCuratorConnectionChange,
  onCuratorMaxOutputTokensChange,
  onCustomBriefingPromptChange,
  onCustomWriterPromptChange,
  onPromptPresetChange,
}: ConversationPromptSectionProps) {
  const { t: localizeUi } = useUiTranslation();
  const basePrompt = selectedPresetPrompt.trim() || DEFAULT_CONVERSATION_PROMPT;
  const baseBriefingPrompt = selectedPresetBriefingPrompt.trim() || DEFAULT_CONVERSATION_BRIEFING_PROMPT;
  const baseWriterPrompt = selectedPresetWriterPrompt.trim() || DEFAULT_CONVERSATION_WRITER_PROMPT;
  const [draft, setDraft] = useState(customPrompt || basePrompt);
  const [briefingPromptOpen, setBriefingPromptOpen] = useState(false);
  const [briefingPromptDraft, setBriefingPromptDraft] = useState("");
  const [writerPromptOpen, setWriterPromptOpen] = useState(false);
  const [writerPromptDraft, setWriterPromptDraft] = useState("");
  const missingCuratorConnection =
    !!curatorConnectionId && !connections.some((connection) => connection.id === curatorConnectionId);
  const selectedPresetName = promptPresets.find((preset) => preset.id === promptPresetId)?.name;

  useEffect(() => {
    setDraft(customPrompt || basePrompt);
  }, [customPrompt, basePrompt]);

  const commitDraft = () => {
    onCustomPromptChange(chatId, !draft.trim() || draft.trim() === basePrompt.trim() ? null : draft);
  };

  const resetPrompt = () => {
    onCustomPromptChange(chatId, null);
    setDraft(basePrompt);
  };

  const closeBriefingPromptEditor = () => {
    onCustomBriefingPromptChange(
      !briefingPromptDraft.trim() || briefingPromptDraft.trim() === baseBriefingPrompt.trim()
        ? null
        : briefingPromptDraft,
    );
    setBriefingPromptOpen(false);
  };

  const closeWriterPromptEditor = () => {
    onCustomWriterPromptChange(
      !writerPromptDraft.trim() || writerPromptDraft.trim() === baseWriterPrompt.trim() ? null : writerPromptDraft,
    );
    setWriterPromptOpen(false);
  };

  return (
    <>
      <ChatSettingsSection
        id="conversation-generation-pipeline"
        label={localizeUi("ui.chatSettings.conversationpromptsection.messageGenerationPipeline")}
        icon={<GitBranch size="0.875rem" />}
        help={localizeUi(
          "ui.chatSettings.conversationpromptsection.standardWritesDirectlyFromResolvedContextTwoPassCreates",
        )}
      >
        <select
          value={pipeline}
          onChange={(event) => onPipelineChange(event.target.value as ConversationGenerationPipeline)}
          className="mari-preset-native-select w-full rounded-lg bg-[var(--secondary)] px-3 py-2 pr-8 text-xs text-[var(--foreground)] outline-none ring-1 ring-[var(--border)] focus:ring-[var(--primary)]/40"
        >
          <option value="standard">{localizeUi("ui.game.gamesetupwizard.standard")}</option>
          <option value="two_pass">{localizeUi("ui.chatSettings.conversationpromptsection.twoPass")}</option>
        </select>
      </ChatSettingsSection>

      <ChatSettingsSection
        id="conversation-prompt"
        label={localizeUi("chat.toolbar.promptPreset")}
        icon={<Sliders size="0.875rem" />}
        help={localizeUi("ui.chatSettings.conversationpromptsection.chooseAPresetConversationPromptAndOptionallyMakeA")}
      >
        <div className="space-y-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[0.6875rem] font-medium text-[var(--muted-foreground)]">
              {localizeUi("ui.chatSettings.conversationpromptsection.promptSource")}
            </span>
            <select
              value={promptPresetId ?? ""}
              onChange={(event) => onPromptPresetChange(event.target.value || null)}
              disabled={promptPresets.length === 0}
              className="mari-preset-native-select w-full rounded-lg bg-[var(--secondary)] px-3 py-2 pr-8 text-xs text-[var(--foreground)] outline-none ring-1 ring-[var(--border)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="">
                {promptPresets.length === 0
                  ? localizeUi("ui.chatSettings.conversationpromptsection.noPresetsAvailable")
                  : localizeUi("ui.chatSettings.conversationpromptsection.defaultConversationPrompt")}
              </option>
              {promptPresets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-center justify-between gap-2">
            <span className="text-[0.6875rem] font-medium text-[var(--foreground)]">
              {localizeUi("ui.chatSettings.conversationpromptsection.conversationPrompt_2a3897c")}
            </span>
            <div className="flex shrink-0 items-center gap-1.5">
              <span className="rounded-full bg-[var(--background)] px-2 py-0.5 text-[0.5625rem] font-medium text-[var(--muted-foreground)] ring-1 ring-[var(--border)]">
                {customPrompt
                  ? localizeUi("settings.notifications.customSound.status.custom")
                  : promptPresetId
                    ? localizeUi("chat.toolbar.preset")
                    : localizeUi("ui.noodle.noodlehome.default")}
              </span>
              {customPrompt && (
                <button
                  type="button"
                  onClick={resetPrompt}
                  className="mari-chrome-control mari-chrome-control--small p-2"
                  title={localizeUi("ui.chatSettings.conversationpromptsection.resetPrompt")}
                >
                  <RotateCcw size="0.625rem" />
                </button>
              )}
            </div>
          </div>

          <MacroTextarea
            value={draft}
            onChange={setDraft}
            onBlur={commitDraft}
            onExpandedClose={commitDraft}
            title={localizeUi("ui.chatSettings.conversationpromptsection.editConversationPrompt")}
            placeholder={localizeUi("ui.chatSettings.conversationpromptsection.enterYourCustomConversationPrompt")}
            rows={6}
            className="mari-editor-field min-h-[9rem] w-full p-3 font-mono text-xs"
            spellCheck={false}
          />

          {pipeline === "two_pass" && (
            <div className="space-y-3 rounded-lg bg-[var(--secondary)]/60 p-3 ring-1 ring-[var(--border)]">
              <label className="flex flex-col gap-1.5">
                <span className="text-[0.6875rem] font-medium text-[var(--foreground)]">
                  {localizeUi("ui.chatSettings.conversationpromptsection.contextCuratorConnection")}
                </span>
                <select
                  value={curatorConnectionId}
                  onChange={(event) => onCuratorConnectionChange(event.target.value || null)}
                  className="mari-preset-native-select w-full rounded-lg bg-[var(--background)] px-3 py-2 pr-8 text-xs text-[var(--foreground)] outline-none ring-1 ring-[var(--border)]"
                >
                  <option value="">{localizeUi("ui.agents.agenteditor.useChatConnection")}</option>
                  {connections.map((connection) => (
                    <option key={connection.id} value={connection.id}>
                      {connection.name}
                      {connection.model
                        ? localizeUi("ui.chatSettings.connectionsection.value1", { value1: connection.model })
                        : ""}
                    </option>
                  ))}
                  {missingCuratorConnection && (
                    <option value={curatorConnectionId}>
                      {localizeUi("ui.chatSettings.conversationpromptsection.unavailableConnection")}
                    </option>
                  )}
                </select>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[0.6875rem] font-medium text-[var(--foreground)]">
                  {localizeUi("ui.chatSettings.conversationpromptsection.curatorMaximumOutputTokens")}
                </span>
                <input
                  type="number"
                  min={CONVERSATION_CURATOR_OUTPUT_TOKENS.MIN}
                  max={CONVERSATION_CURATOR_OUTPUT_TOKENS.MAX}
                  value={curatorMaxOutputTokens}
                  onChange={(event) => onCuratorMaxOutputTokensChange(Number(event.target.value))}
                  className="mari-editor-field w-full px-3 py-2 text-xs"
                />
              </label>
              {[
                {
                  label: "Conversation Briefing prompt",
                  custom: customBriefingPrompt,
                  base: baseBriefingPrompt,
                  open: () => {
                    setBriefingPromptDraft(customBriefingPrompt || baseBriefingPrompt);
                    setBriefingPromptOpen(true);
                  },
                  reset: () => onCustomBriefingPromptChange(null),
                },
                {
                  label: "Conversation Writer prompt",
                  custom: customWriterPrompt,
                  base: baseWriterPrompt,
                  open: () => {
                    setWriterPromptDraft(customWriterPrompt || baseWriterPrompt);
                    setWriterPromptOpen(true);
                  },
                  reset: () => onCustomWriterPromptChange(null),
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className="flex items-center gap-2 rounded-lg bg-[var(--background)] px-3 py-2 ring-1 ring-[var(--border)]"
                >
                  <div className="min-w-0 flex-1">
                    <span className="block text-[0.6875rem] font-medium text-[var(--foreground)]">{item.label}</span>
                    <span className="block text-[0.625rem] text-[var(--muted-foreground)]">
                      {item.custom
                        ? localizeUi("ui.chatSettings.conversationpromptsection.usingChatLocalEdit")
                        : promptPresetId
                          ? localizeUi("ui.chatSettings.conversationpromptsection.fromValue1", {
                              value1:
                                selectedPresetName ??
                                localizeUi("ui.chatSettings.conversationpromptsection.selectedPreset"),
                            })
                          : localizeUi("ui.agents.agenteditor.usingBuiltInDefault")}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={item.open}
                    className="mari-chrome-control mari-chrome-control--small p-2"
                    title={localizeUi("ui.chat.worldfieldrow.editValue1", { value1: item.label })}
                  >
                    <Pencil size="0.625rem" />
                  </button>
                  {item.custom && (
                    <button
                      type="button"
                      onClick={item.reset}
                      className="mari-chrome-control mari-chrome-control--small p-2"
                      title={localizeUi("ui.chatSettings.conversationpromptsection.resetValue1", {
                        value1: item.label,
                      })}
                    >
                      <Trash2 size="0.625rem" />
                    </button>
                  )}
                </div>
              ))}
              <div
                className={`flex items-center gap-2 text-[0.6875rem] ${missingCuratorConnection ? "text-[var(--destructive)]" : "text-[var(--muted-foreground)]"}`}
              >
                {missingCuratorConnection ? <AlertTriangle size="0.75rem" /> : <CheckCircle2 size="0.75rem" />}
                {missingCuratorConnection
                  ? localizeUi("ui.chatSettings.conversationpromptsection.theSelectedCuratorConnectionIsUnavailable")
                  : localizeUi("ui.chatSettings.conversationpromptsection.twoPassConfigurationIsReady")}
              </div>
            </div>
          )}
        </div>
      </ChatSettingsSection>
      <ExpandedTextarea
        open={briefingPromptOpen}
        onClose={closeBriefingPromptEditor}
        title={localizeUi("ui.chatSettings.conversationpromptsection.editConversationBriefingPrompt")}
        value={briefingPromptDraft}
        onChange={setBriefingPromptDraft}
        placeholder={localizeUi("ui.chatSettings.conversationpromptsection.enterTheContextCuratorPrompt")}
        surface="chat"
      />
      <ExpandedTextarea
        open={writerPromptOpen}
        onClose={closeWriterPromptEditor}
        title={localizeUi("ui.chatSettings.conversationpromptsection.editConversationWriterPrompt")}
        value={writerPromptDraft}
        onChange={setWriterPromptDraft}
        placeholder={localizeUi("ui.chatSettings.conversationpromptsection.enterTheIsolatedResponseWriterPrompt")}
        surface="chat"
      />
    </>
  );
}
