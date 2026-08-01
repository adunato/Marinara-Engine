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
      toast.error("Character Mind agent configuration is not available");
      return;
    }
    try {
      await updateAgent.mutateAsync({ id: config.id, connectionId: connectionDraft || null });
      toast.success("Character Mind connection saved");
    } catch (error) {
      toast.error(errorMessage(error, "Could not save the Character Mind connection"));
    }
  };

  const runBuild = async () => {
    if (
      !window.confirm(
        status.data?.initialized
          ? "Resume this Character Mind Build from its saved map and completed pages?"
          : "Build this Character Mind now? Marinara will first map the complete Character Card, auto-summary, and Daily Memory corpus, then generate the mapped wiki pages.",
      )
    )
      return;
    setOperationResult(null);
    try {
      const value = await build.mutateAsync();
      setOperationResult({ kind: "build", value });
      toast.success(value.pendingSources.length ? "Build paused with pending sources" : "Character Mind built");
    } catch (error) {
      toast.error(errorMessage(error, "Character Mind build failed"));
    }
  };

  const restartBuild = async () => {
    if (
      !window.confirm(
        "Restart this Character Mind Build from scratch? Existing generated wiki pages and the saved map will be deleted. Raw sources are preserved.",
      )
    )
      return;
    setOperationResult(null);
    try {
      const value = await restart.mutateAsync();
      setOperationResult({ kind: "build", value });
      toast.success("Character Mind rebuilt");
    } catch (error) {
      toast.error(errorMessage(error, "Character Mind restart failed"));
    }
  };

  const runSync = async () => {
    setOperationResult(null);
    try {
      const value = await sync.mutateAsync();
      setOperationResult({ kind: "sync", value });
      toast.success(value.pendingSources.length ? "Sync finished with pending sources" : "Character Mind is current");
    } catch (error) {
      toast.error(errorMessage(error, "Character Mind sync failed"));
    }
  };

  const runLint = async () => {
    setOperationResult(null);
    try {
      const value = await lint.mutateAsync();
      setOperationResult({ kind: "lint", value });
      toast.success("Character Mind lint completed");
    } catch (error) {
      toast.error(errorMessage(error, "Character Mind lint failed"));
    }
  };

  const runQuery = async () => {
    const value = queryText.trim();
    if (!value) return;
    setQueryResult(null);
    try {
      setQueryResult(await query.mutateAsync(value));
    } catch (error) {
      toast.error(errorMessage(error, "Character Mind query failed"));
    }
  };

  const cancelOperation = async () => {
    try {
      const value = await cancel.mutateAsync();
      toast.success(value.cancelled ? "Cancellation requested" : "No Character Mind operation was active");
    } catch (error) {
      toast.error(errorMessage(error, "Could not cancel the Character Mind operation"));
    }
  };

  const openMindFolder = async () => {
    try {
      await openFolder.mutateAsync();
    } catch (error) {
      toast.error(getPrivilegedActionErrorMessage(error, "Could not open the Character Mind folder"));
    }
  };

  const copyPath = async () => {
    if (!status.data?.path) return;
    toast.success((await copyToClipboard(status.data.path)) ? "Character Mind path copied" : "Could not copy path");
  };

  return (
    <Modal open={open} onClose={onClose} title="Character Mind" width="max-w-4xl" chatFloatingPanel mobileFullscreen>
      <div className="space-y-4" data-testid="character-mind-modal">
        <section className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/55 p-3">
          <div>
            <p className="text-xs font-semibold text-[var(--foreground)]">Agent connection</p>
            <p className="mt-1 text-[0.625rem] leading-relaxed text-[var(--muted-foreground)]">
              Global for every Character Mind. The same connection runs mapping, build, sync, query, and lint.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              aria-label="Character Mind connection"
              value={connectionDraft}
              onChange={(event) => setConnectionDraft(event.target.value)}
              disabled={configsLoading || updateAgent.isPending}
              className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs outline-none focus:border-[var(--primary)]/50 disabled:opacity-50"
            >
              <option value="">
                {defaultAgentConnection
                  ? `Agent default (${defaultAgentConnection.name})`
                  : "Agent default, then Conversation connection"}
              </option>
              {import.meta.env.VITE_MARINARA_LITE !== "true" && (
                <option value={LOCAL_SIDECAR_CONNECTION_ID}>Local Model (sidecar)</option>
              )}
              {selectedConnectionMissing && <option value={connectionDraft}>Unavailable connection</option>}
              {connectionOptions.map((connection) => (
                <option key={connection.id} value={connection.id}>
                  {connection.name}
                  {connection.model ? ` — ${connection.model}` : ""}
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
              Save connection
            </button>
          </div>
        </section>

        {availableCharacters.length === 0 ? (
          <p className="rounded-xl border border-amber-400/25 bg-amber-400/10 px-3 py-3 text-xs text-amber-300">
            Add a character to this Conversation before building a Character Mind.
          </p>
        ) : (
          <>
            {availableCharacters.length > 1 && (
              <label className="block space-y-1.5 text-xs font-medium">
                <span>Character</span>
                <select
                  aria-label="Character Mind character"
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
                      <p className="mt-1 text-[0.625rem] text-[var(--muted-foreground)]">Loading status…</p>
                    ) : status.isError ? (
                      <p className="mt-1 text-[0.625rem] text-red-400">Could not load Character Mind status.</p>
                    ) : (
                      <p className="mt-1 text-[0.625rem] text-[var(--muted-foreground)]">
                        {status.data?.built ? "Built" : status.data?.initialized ? "Build incomplete" : "Not built"}
                        {status.data?.pendingSources.length
                          ? ` · ${status.data.pendingSources.length} source${status.data.pendingSources.length === 1 ? "" : "s"} pending`
                          : status.data?.built
                            ? " · Up to date"
                            : ""}
                      </p>
                    )}
                  </div>
                </div>
                {activeOperation && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--primary)]/12 px-2.5 py-1 text-[0.625rem] font-medium text-[var(--primary)]">
                    <Loader2 size="0.7rem" className="animate-spin" /> {operationLabel(activeOperation.name)} running
                  </span>
                )}
              </div>

              {status.data?.lastLogEntry && (
                <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                  Last operation: {operationLabel(status.data.lastLogEntry.operation)} ·{" "}
                  {status.data.lastLogEntry.status} · {new Date(status.data.lastLogEntry.timestamp).toLocaleString()}
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
                      {status.data?.initialized ? "Resume Build" : "Build"}
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
                        Restart Build
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
                      Sync
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
                      Lint & repair
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
                      Open folder
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
                    Cancel
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
                    aria-label="Copy Character Mind path"
                    className="shrink-0 rounded-md p-1 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
                  >
                    <Clipboard size="0.75rem" />
                  </button>
                </div>
              )}
            </section>

            {operationResult && (
              <section className="rounded-xl border border-[var(--border)] bg-[var(--secondary)]/45 p-3 text-xs">
                <p className="font-semibold">{operationLabel(operationResult.kind)} result</p>
                {operationResult.kind === "lint" ? (
                  <div className="mt-2 space-y-1 text-[0.6875rem] leading-relaxed text-[var(--muted-foreground)]">
                    <p>{operationResult.value.summary}</p>
                    {operationResult.value.findings.map((finding, index) => (
                      <p key={`${index}-${finding}`}>• {finding}</p>
                    ))}
                    <p>{operationResult.value.changed.length} file(s) changed.</p>
                  </div>
                ) : (
                  <div className="mt-2 space-y-1 text-[0.6875rem] text-[var(--muted-foreground)]">
                    <p>{operationResult.value.snapshotsCreated.length} snapshot(s) created.</p>
                    <p>
                      {operationResult.value.processed.filter((item) => !item.error).length} source(s) processed;{" "}
                      {operationResult.value.processed.filter((item) => item.error).length} failed;{" "}
                      {operationResult.value.pendingSources.length} pending.
                    </p>
                  </div>
                )}
              </section>
            )}

            {status.data?.built && (
              <section className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/45 p-3">
                <div>
                  <p className="flex items-center gap-1.5 text-xs font-semibold">
                    <Search size="0.75rem" className="text-[var(--primary)]" /> Query the mind
                  </p>
                  <p className="mt-1 text-[0.625rem] leading-relaxed text-[var(--muted-foreground)]">
                    Returns a standalone cited briefing. It is not yet used for normal message generation.
                  </p>
                </div>
                <textarea
                  aria-label="Character Mind query"
                  value={queryText}
                  onChange={(event) => setQueryText(event.target.value)}
                  maxLength={32_768}
                  placeholder="What does this character currently think and remember about…"
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
                  Create briefing
                </button>
                {queryResult && (
                  <div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
                    <p className="whitespace-pre-wrap text-xs leading-relaxed">{queryResult.briefing}</p>
                    <div className="text-[0.625rem] text-[var(--muted-foreground)]">
                      <p>{queryResult.wikiPages.length} wiki page(s) read.</p>
                      <p>{queryResult.rawSources.length} raw source(s) read.</p>
                    </div>
                  </div>
                )}
              </section>
            )}

            {!config && !configsLoading && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-[0.625rem] leading-relaxed text-amber-300">
                <AlertTriangle size="0.75rem" className="mt-0.5 shrink-0" />
                The Character Mind agent configuration is unavailable. Remove and re-add the agent before running it.
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
