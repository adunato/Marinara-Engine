import {
  CHARACTER_MIND_AGENT_ID,
  LOCAL_SIDECAR_CONNECTION_ID,
  type CharacterMindBuildOrSyncResult,
  type CharacterMindLintResult,
  type CharacterMindQueryResult,
} from "@marinara-engine/shared";
import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  Clipboard,
  FolderOpen,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Square,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { useAgentConfigs, useUpdateAgent } from "../../hooks/use-agents";
import {
  useBuildCharacterMind,
  useCancelCharacterMind,
  useCharacterMindStatus,
  useLintCharacterMind,
  useOpenCharacterMindFolder,
  useQueryCharacterMind,
  useRestartCharacterMind,
  useSyncCharacterMind,
} from "../../hooks/use-character-minds";
import { useConnections } from "../../hooks/use-connections";
import { getPrivilegedActionErrorMessage } from "../../lib/api-client";
import { filterLanguageGenerationConnections } from "../../lib/connection-filters";
import { copyToClipboard } from "../../lib/utils";
import { Modal } from "../ui/Modal";
import { useTranslation as useUiTranslation } from "react-i18next";

type CharacterOption = {
  id: string;
  data: unknown;
};

type ConnectionOption = {
  id: string;
  name: string;
  model?: string | null;
  provider?: string | null;
  defaultForAgents?: boolean | string | null;
};

type OperationResult =
  | { kind: "build" | "sync"; value: CharacterMindBuildOrSyncResult }
  | { kind: "lint"; value: CharacterMindLintResult };

interface CharacterMindModalProps {
  chatId: string;
  characterIds: string[];
  characters: CharacterOption[];
  open: boolean;
  onClose: () => void;
}

function characterName(character: CharacterOption | undefined): string {
  if (!character) return "Unknown character";
  try {
    const data = typeof character.data === "string" ? JSON.parse(character.data) : character.data;
    if (data && typeof data === "object" && typeof (data as { name?: unknown }).name === "string") {
      return (data as { name: string }).name.trim() || "Unknown character";
    }
  } catch {
    // Fall through to the stable fallback.
  }
  return "Unknown character";
}

function operationLabel(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function CharacterMindModal({ chatId, characterIds, characters, open, onClose }: CharacterMindModalProps) {
  const { t: localizeUi } = useUiTranslation();
  const availableCharacters = useMemo(
    () => characterIds.map((id) => characters.find((character) => character.id === id) ?? { id, data: null }),
    [characterIds, characters],
  );
  const [characterId, setCharacterId] = useState(characterIds[0] ?? "");
  const [connectionDraft, setConnectionDraft] = useState("");
  const [queryText, setQueryText] = useState("");
  const [queryResult, setQueryResult] = useState<CharacterMindQueryResult | null>(null);
  const [operationResult, setOperationResult] = useState<OperationResult | null>(null);

  const { data: configs = [], isLoading: configsLoading } = useAgentConfigs(open);
  const { data: connections = [] } = useConnections();
  const updateAgent = useUpdateAgent();
  const config = configs.find((candidate) => candidate.type === CHARACTER_MIND_AGENT_ID) ?? null;
  const connectionOptions = useMemo(
    () => filterLanguageGenerationConnections(connections as ConnectionOption[]),
    [connections],
  );
  const defaultAgentConnection = connectionOptions.find(
    (connection) => connection.defaultForAgents === true || connection.defaultForAgents === "true",
  );

  const status = useCharacterMindStatus(chatId, characterId, open && !!characterId);
  const build = useBuildCharacterMind(chatId, characterId);
  const restart = useRestartCharacterMind(chatId, characterId);
  const sync = useSyncCharacterMind(chatId, characterId);
  const lint = useLintCharacterMind(chatId, characterId);
  const cancel = useCancelCharacterMind(chatId, characterId);
  const openFolder = useOpenCharacterMindFolder(chatId, characterId);
  const query = useQueryCharacterMind(chatId, characterId);

  useEffect(() => {
    if (!open) return;
    if (!characterIds.includes(characterId)) setCharacterId(characterIds[0] ?? "");
  }, [characterId, characterIds, open]);

  useEffect(() => {
    setConnectionDraft(config?.connectionId ?? "");
  }, [config?.connectionId]);

  useEffect(() => {
    setQueryResult(null);
    setOperationResult(null);
  }, [characterId]);

  const activeOperation = status.data?.activeOperation ?? null;
  const requestPending = build.isPending || restart.isPending || sync.isPending || lint.isPending || query.isPending;
  const operationActive = Boolean(activeOperation) || requestPending;
  const selectedConnectionMissing =
    !!connectionDraft &&
    connectionDraft !== LOCAL_SIDECAR_CONNECTION_ID &&
    !connectionOptions.some((connection) => connection.id === connectionDraft);

  const saveConnection = async () => {
    if (!config) {
      toast.error(localizeUi("ui.chat.charactermindmodal.characterMindAgentConfigurationIsNotAvailable"));
      return;
    }
    try {
      await updateAgent.mutateAsync({ id: config.id, connectionId: connectionDraft || null });
      toast.success(localizeUi("ui.chat.charactermindmodal.characterMindConnectionSaved"));
    } catch (error) {
      toast.error(errorMessage(error, localizeUi("ui.chat.charactermindmodal.couldNotSaveTheCharacterMindConnection")));
    }
  };

  const runBuild = async () => {
    if (
      !window.confirm(
        status.data?.initialized
          ? localizeUi("ui.chat.charactermindmodal.resumeThisCharacterMindBuildFromItsSavedMap")
          : localizeUi("ui.chat.charactermindmodal.buildThisCharacterMindNowMarinaraWillFirstMap"),
      )
    )
      return;
    setOperationResult(null);
    try {
      const value = await build.mutateAsync();
      setOperationResult({ kind: "build", value });
      toast.success(
        value.pendingSources.length
          ? localizeUi("ui.chat.charactermindmodal.buildPausedWithPendingSources")
          : localizeUi("ui.chat.charactermindmodal.characterMindBuilt"),
      );
    } catch (error) {
      toast.error(errorMessage(error, localizeUi("ui.chat.charactermindmodal.characterMindBuildFailed")));
    }
  };

  const restartBuild = async () => {
    if (
      !window.confirm(
        localizeUi("ui.chat.charactermindmodal.restartThisCharacterMindBuildFromScratchExistingGenerated"),
      )
    )
      return;
    setOperationResult(null);
    try {
      const value = await restart.mutateAsync();
      setOperationResult({ kind: "build", value });
      toast.success(localizeUi("ui.chat.charactermindmodal.characterMindRebuilt"));
    } catch (error) {
      toast.error(errorMessage(error, localizeUi("ui.chat.charactermindmodal.characterMindRestartFailed")));
    }
  };

  const runSync = async () => {
    setOperationResult(null);
    try {
      const value = await sync.mutateAsync();
      setOperationResult({ kind: "sync", value });
      toast.success(
        value.pendingSources.length
          ? localizeUi("ui.chat.charactermindmodal.syncFinishedWithPendingSources")
          : localizeUi("ui.chat.charactermindmodal.characterMindIsCurrent"),
      );
    } catch (error) {
      toast.error(errorMessage(error, localizeUi("ui.chat.charactermindmodal.characterMindSyncFailed")));
    }
  };

  const runLint = async () => {
    setOperationResult(null);
    try {
      const value = await lint.mutateAsync();
      setOperationResult({ kind: "lint", value });
      toast.success(localizeUi("ui.chat.charactermindmodal.characterMindLintCompleted"));
    } catch (error) {
      toast.error(errorMessage(error, localizeUi("ui.chat.charactermindmodal.characterMindLintFailed")));
    }
  };

  const runQuery = async () => {
    const value = queryText.trim();
    if (!value) return;
    setQueryResult(null);
    try {
      setQueryResult(await query.mutateAsync(value));
    } catch (error) {
      toast.error(errorMessage(error, localizeUi("ui.chat.charactermindmodal.characterMindQueryFailed")));
    }
  };

  const cancelOperation = async () => {
    try {
      const value = await cancel.mutateAsync();
      toast.success(
        value.cancelled
          ? localizeUi("ui.chat.charactermindmodal.cancellationRequested")
          : localizeUi("ui.chat.charactermindmodal.noCharacterMindOperationWasActive"),
      );
    } catch (error) {
      toast.error(
        errorMessage(error, localizeUi("ui.chat.charactermindmodal.couldNotCancelTheCharacterMindOperation")),
      );
    }
  };

  const openMindFolder = async () => {
    try {
      await openFolder.mutateAsync();
    } catch (error) {
      toast.error(
        getPrivilegedActionErrorMessage(
          error,
          localizeUi("ui.chat.charactermindmodal.couldNotOpenTheCharacterMindFolder"),
        ),
      );
    }
  };

  const copyPath = async () => {
    if (!status.data?.path) return;
    toast.success(
      (await copyToClipboard(status.data.path))
        ? localizeUi("ui.chat.charactermindmodal.characterMindPathCopied")
        : localizeUi("ui.chat.charactermindmodal.couldNotCopyPath"),
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={localizeUi("ui.chat.charactermindmodal.characterMind")}
      width="max-w-4xl"
      chatFloatingPanel
      mobileFullscreen
    >
      <div className="space-y-4" data-testid="character-mind-modal">
        <section className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/55 p-3">
          <div>
            <p className="text-xs font-semibold text-[var(--foreground)]">
              {localizeUi("ui.chat.charactermindmodal.agentConnection")}
            </p>
            <p className="mt-1 text-[0.625rem] leading-relaxed text-[var(--muted-foreground)]">
              {localizeUi("ui.chat.charactermindmodal.globalForEveryCharacterMindTheSameConnectionRuns")}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              aria-label={localizeUi("ui.chat.charactermindmodal.characterMindConnection")}
              value={connectionDraft}
              onChange={(event) => setConnectionDraft(event.target.value)}
              disabled={configsLoading || updateAgent.isPending}
              className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs outline-none focus:border-[var(--primary)]/50 disabled:opacity-50"
            >
              <option value="">
                {defaultAgentConnection
                  ? localizeUi("ui.agents.agenteditor.agentDefaultValue1", { value1: defaultAgentConnection.name })
                  : localizeUi("ui.chat.charactermindmodal.agentDefaultThenConversationConnection")}
              </option>
              {import.meta.env.VITE_MARINARA_LITE !== "true" && (
                <option value={LOCAL_SIDECAR_CONNECTION_ID}>
                  {localizeUi("ui.agents.agenteditor.localModelSidecar")}
                </option>
              )}
              {selectedConnectionMissing && (
                <option value={connectionDraft}>
                  {localizeUi("ui.chat.charactermindmodal.unavailableConnection")}
                </option>
              )}
              {connectionOptions.map((connection) => (
                <option key={connection.id} value={connection.id}>
                  {connection.name}
                  {connection.model ? localizeUi("ui.chat.datablock.value1", { value1: connection.model }) : ""}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void saveConnection()}
              disabled={!config || updateAgent.isPending || connectionDraft === (config.connectionId ?? "")}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-medium text-[var(--primary-foreground)] disabled:opacity-50"
            >
              {updateAgent.isPending ? (
                <Loader2 size="0.75rem" className="animate-spin" />
              ) : (
                <CheckCircle2 size="0.75rem" />
              )}
              {localizeUi("ui.chat.charactermindmodal.saveConnection")}
            </button>
          </div>
        </section>

        {availableCharacters.length === 0 ? (
          <p className="rounded-xl border border-amber-400/25 bg-amber-400/10 px-3 py-3 text-xs text-amber-300">
            {localizeUi("ui.chat.charactermindmodal.addACharacterToThisConversationBeforeBuildingA")}
          </p>
        ) : (
          <>
            {availableCharacters.length > 1 && (
              <label className="block space-y-1.5 text-xs font-medium">
                <span>{localizeUi("ui.chat.mariediteasyviewer.character")}</span>
                <select
                  aria-label={localizeUi("ui.chat.charactermindmodal.characterMindCharacter")}
                  value={characterId}
                  onChange={(event) => setCharacterId(event.target.value)}
                  disabled={operationActive}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs outline-none focus:border-[var(--primary)]/50 disabled:opacity-50"
                >
                  {availableCharacters.map((character) => (
                    <option key={character.id} value={character.id}>
                      {characterName(character)}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <section className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--background)]/70 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-2.5">
                  <Brain size="1rem" className="mt-0.5 shrink-0 text-[var(--primary)]" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">
                      {characterName(availableCharacters.find((c) => c.id === characterId))}
                    </p>
                    {status.isLoading ? (
                      <p className="mt-1 text-[0.625rem] text-[var(--muted-foreground)]">
                        {localizeUi("ui.chat.charactermindmodal.loadingStatus")}
                      </p>
                    ) : status.isError ? (
                      <p className="mt-1 text-[0.625rem] text-red-400">
                        {localizeUi("ui.chat.charactermindmodal.couldNotLoadCharacterMindStatus")}
                      </p>
                    ) : (
                      <p className="mt-1 text-[0.625rem] text-[var(--muted-foreground)]">
                        {status.data?.built
                          ? localizeUi("ui.chat.charactermindmodal.built")
                          : status.data?.initialized
                            ? localizeUi("ui.chat.charactermindmodal.buildIncomplete")
                            : localizeUi("ui.chat.charactermindmodal.notBuilt")}
                        {status.data?.pendingSources.length
                          ? localizeUi("ui.chat.charactermindmodal.value1SourceValue2Pending", {
                              value1: status.data.pendingSources.length,
                              value2:
                                status.data.pendingSources.length === 1
                                  ? ""
                                  : localizeUi("ui.noodle.stageprofileview.s"),
                            })
                          : status.data?.built
                            ? localizeUi("ui.chat.charactermindmodal.upToDate")
                            : ""}
                      </p>
                    )}
                  </div>
                </div>
                {activeOperation && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--primary)]/12 px-2.5 py-1 text-[0.625rem] font-medium text-[var(--primary)]">
                    <Loader2 size="0.7rem" className="animate-spin" /> {operationLabel(activeOperation.name)}{" "}
                    {localizeUi("ui.chat.charactermindmodal.running")}
                  </span>
                )}
              </div>

              {status.data?.lastLogEntry && (
                <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                  {localizeUi("ui.chat.charactermindmodal.lastOperation")}{" "}
                  {operationLabel(status.data.lastLogEntry.operation)} · {status.data.lastLogEntry.status} ·{" "}
                  {new Date(status.data.lastLogEntry.timestamp).toLocaleString()}
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                {!status.data?.built ? (
                  <>
                    <button
                      type="button"
                      data-testid="build-character-mind"
                      onClick={() => void runBuild()}
                      disabled={operationActive || status.isLoading}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-medium text-[var(--primary-foreground)] disabled:opacity-50"
                    >
                      {build.isPending ? <Loader2 size="0.75rem" className="animate-spin" /> : <Play size="0.75rem" />}
                      {status.data?.initialized
                        ? localizeUi("ui.chat.charactermindmodal.resumeBuild")
                        : localizeUi("ui.chat.charactermindmodal.build")}
                    </button>
                    {status.data?.initialized && (
                      <button
                        type="button"
                        data-testid="restart-character-mind"
                        onClick={() => void restartBuild()}
                        disabled={operationActive || status.isLoading}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-red-400/30 px-3 py-2 text-xs font-medium text-red-400 hover:bg-red-400/10 disabled:opacity-50"
                      >
                        {restart.isPending ? (
                          <Loader2 size="0.75rem" className="animate-spin" />
                        ) : (
                          <RotateCcw size="0.75rem" />
                        )}
                        {localizeUi("ui.chat.charactermindmodal.restartBuild")}
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      data-testid="sync-character-mind"
                      onClick={() => void runSync()}
                      disabled={operationActive}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-medium text-[var(--primary-foreground)] disabled:opacity-50"
                    >
                      {sync.isPending ? (
                        <Loader2 size="0.75rem" className="animate-spin" />
                      ) : (
                        <RefreshCw size="0.75rem" />
                      )}
                      {localizeUi("ui.chat.charactermindmodal.sync")}
                    </button>
                    <button
                      type="button"
                      data-testid="lint-character-mind"
                      onClick={() => void runLint()}
                      disabled={operationActive}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-medium hover:bg-[var(--accent)] disabled:opacity-50"
                    >
                      {lint.isPending ? (
                        <Loader2 size="0.75rem" className="animate-spin" />
                      ) : (
                        <ShieldCheck size="0.75rem" />
                      )}
                      {localizeUi("ui.chat.charactermindmodal.lintRepair")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void openMindFolder()}
                      disabled={openFolder.isPending}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-medium hover:bg-[var(--accent)] disabled:opacity-50"
                    >
                      {openFolder.isPending ? (
                        <Loader2 size="0.75rem" className="animate-spin" />
                      ) : (
                        <FolderOpen size="0.75rem" />
                      )}
                      {localizeUi("ui.chat.charactermindmodal.openFolder")}
                    </button>
                  </>
                )}
                {(activeOperation || requestPending) && (
                  <button
                    type="button"
                    data-testid="cancel-character-mind"
                    onClick={() => void cancelOperation()}
                    disabled={cancel.isPending}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-400/30 px-3 py-2 text-xs font-medium text-red-400 hover:bg-red-400/10 disabled:opacity-50"
                  >
                    {cancel.isPending ? <Loader2 size="0.75rem" className="animate-spin" /> : <Square size="0.7rem" />}
                    {localizeUi("chat.delete.dialog.cancel")}
                  </button>
                )}
              </div>

              {status.data?.path && (
                <div className="flex items-center gap-2 rounded-lg bg-[var(--secondary)]/70 px-2.5 py-2">
                  <code
                    className="min-w-0 flex-1 truncate text-[0.625rem] text-[var(--muted-foreground)]"
                    title={status.data.path}
                  >
                    {status.data.path}
                  </code>
                  <button
                    type="button"
                    onClick={() => void copyPath()}
                    aria-label={localizeUi("ui.chat.charactermindmodal.copyCharacterMindPath")}
                    className="shrink-0 rounded-md p-1 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
                  >
                    <Clipboard size="0.75rem" />
                  </button>
                </div>
              )}
            </section>

            {operationResult && (
              <section className="rounded-xl border border-[var(--border)] bg-[var(--secondary)]/45 p-3 text-xs">
                <p className="font-semibold">
                  {operationLabel(operationResult.kind)} {localizeUi("ui.chat.charactermindmodal.result")}
                </p>
                {operationResult.kind === "lint" ? (
                  <div className="mt-2 space-y-1 text-[0.6875rem] leading-relaxed text-[var(--muted-foreground)]">
                    <p>{operationResult.value.summary}</p>
                    {operationResult.value.findings.map((finding, index) => (
                      <p key={`${index}-${finding}`}>• {finding}</p>
                    ))}
                    <p>
                      {operationResult.value.changed.length} {localizeUi("ui.chat.charactermindmodal.fileSChanged")}
                    </p>
                  </div>
                ) : (
                  <div className="mt-2 space-y-1 text-[0.6875rem] text-[var(--muted-foreground)]">
                    <p>
                      {operationResult.value.snapshotsCreated.length}{" "}
                      {localizeUi("ui.chat.charactermindmodal.snapshotSCreated")}
                    </p>
                    <p>
                      {operationResult.value.processed.filter((item) => !item.error).length}{" "}
                      {localizeUi("ui.chat.charactermindmodal.sourceSProcessed")}{" "}
                      {operationResult.value.processed.filter((item) => item.error).length}{" "}
                      {localizeUi("ui.chat.charactermindmodal.failed")} {operationResult.value.pendingSources.length}{" "}
                      {localizeUi("ui.chat.charactermindmodal.pending")}
                    </p>
                  </div>
                )}
              </section>
            )}

            {status.data?.built && (
              <section className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/45 p-3">
                <div>
                  <p className="flex items-center gap-1.5 text-xs font-semibold">
                    <Search size="0.75rem" className="text-[var(--primary)]" />{" "}
                    {localizeUi("ui.chat.charactermindmodal.queryTheMind")}
                  </p>
                  <p className="mt-1 text-[0.625rem] leading-relaxed text-[var(--muted-foreground)]">
                    {localizeUi("ui.chat.charactermindmodal.returnsAStandaloneCitedBriefingItIsNotYet")}
                  </p>
                </div>
                <textarea
                  aria-label={localizeUi("ui.chat.charactermindmodal.characterMindQuery")}
                  value={queryText}
                  onChange={(event) => setQueryText(event.target.value)}
                  maxLength={32_768}
                  placeholder={localizeUi(
                    "ui.chat.charactermindmodal.whatDoesThisCharacterCurrentlyThinkAndRememberAbout",
                  )}
                  className="min-h-24 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs leading-relaxed outline-none focus:border-[var(--primary)]/50"
                />
                <button
                  type="button"
                  data-testid="query-character-mind"
                  onClick={() => void runQuery()}
                  disabled={!queryText.trim() || operationActive}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-medium text-[var(--primary-foreground)] disabled:opacity-50"
                >
                  {query.isPending ? <Loader2 size="0.75rem" className="animate-spin" /> : <Search size="0.75rem" />}
                  {localizeUi("ui.chat.charactermindmodal.createBriefing")}
                </button>
                {queryResult && (
                  <div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
                    <p className="whitespace-pre-wrap text-xs leading-relaxed">{queryResult.briefing}</p>
                    <div className="text-[0.625rem] text-[var(--muted-foreground)]">
                      <p>
                        {queryResult.wikiPages.length} {localizeUi("ui.chat.charactermindmodal.wikiPageSRead")}
                      </p>
                      <p>
                        {queryResult.rawSources.length} {localizeUi("ui.chat.charactermindmodal.rawSourceSRead")}
                      </p>
                    </div>
                  </div>
                )}
              </section>
            )}

            {!config && !configsLoading && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-[0.625rem] leading-relaxed text-amber-300">
                <AlertTriangle size="0.75rem" className="mt-0.5 shrink-0" />
                {localizeUi("ui.chat.charactermindmodal.theCharacterMindAgentConfigurationIsUnavailableRemoveAnd")}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
