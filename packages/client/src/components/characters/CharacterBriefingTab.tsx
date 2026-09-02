import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Save, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useConnections } from "../../hooks/use-connections";
import { useCharacters } from "../../hooks/use-characters";
import { useLorebooks } from "../../hooks/use-lorebooks";
import {
  useCharacterBriefing,
  useGenerateCharacterBriefing,
  useSaveCharacterBriefing,
} from "../../hooks/use-character-briefing";
import { activeCharacterBriefingReferenceQuery, serializeCharacterBriefingReference } from "@marinara-engine/shared";

type EntitySuggestion = { type: "character" | "lorebook"; id: string; label: string };

export function CharacterBriefingTab({ characterId }: { characterId: string }) {
  const { t } = useTranslation();
  const { data: state } = useCharacterBriefing(characterId);
  const { data: connections } = useConnections();
  const { data: characters } = useCharacters();
  const { data: lorebooks } = useLorebooks(undefined, { includeHidden: true });
  const save = useSaveCharacterBriefing();
  const generate = useGenerateCharacterBriefing();
  const [source, setSource] = useState("");
  const [connectionId, setConnectionId] = useState("");
  const [caret, setCaret] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const characterList = useMemo(
    () => (characters ?? []) as Array<{ id?: unknown; name?: unknown }>,
    [characters],
  );
  const lorebookList = useMemo(
    () => (lorebooks ?? []) as Array<{ id?: unknown; name?: unknown }>,
    [lorebooks],
  );
  const connectionList = (connections ?? []) as Array<{ id: string; name: string; provider?: string; model?: string }>;

  useEffect(() => {
    if (!state) return;
    setSource(state.sourceTemplate);
    setConnectionId(state.generationConnectionId ?? "");
  }, [state]);

  const query = activeCharacterBriefingReferenceQuery(source, caret);
  const suggestions = useMemo<EntitySuggestion[]>(() => {
    if (query === null) return [];
    const needle = query.toLowerCase();
    return [
      ...characterList
        .filter(
          (item) =>
            item.id !== characterId &&
            String(item.name ?? "")
              .toLowerCase()
              .includes(needle),
        )
        .slice(0, 5)
        .map((item) => ({ type: "character" as const, id: String(item.id), label: String(item.name ?? item.id) })),
      ...lorebookList
        .filter((item) =>
          String(item.name ?? "")
            .toLowerCase()
            .includes(needle),
        )
        .slice(0, 5)
        .map((item) => ({ type: "lorebook" as const, id: String(item.id), label: String(item.name ?? item.id) })),
    ];
  }, [characterId, characterList, lorebookList, query]);

  const persist = async () => {
    await save.mutateAsync({
      characterId,
      patch: { sourceTemplate: source, generationConnectionId: connectionId || null },
    });
  };
  const runGeneration = async () => {
    try {
      await persist();
      await generate.mutateAsync({ characterId });
      toast.success(t("characterBriefing.updated"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("characterBriefing.generateFailed"));
    }
  };
  const insertSuggestion = (item: EntitySuggestion) => {
    const element = textareaRef.current;
    if (!element || query === null) return;
    const before = source.slice(0, caret);
    const match = before.match(/\$[^$[\]|]*$/u);
    if (!match) return;
    const token = serializeCharacterBriefingReference(item.type, item.id, item.label);
    const next = `${source.slice(0, caret - match[0].length)}${token}${source.slice(caret)}`;
    const nextCaret = caret - match[0].length + token.length;
    setSource(next);
    setCaret(nextCaret);
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(nextCaret, nextCaret);
    });
  };
  const languageConnections = connectionList.filter(
    (item) => !["image_generation", "video_generation", "audio"].includes(item.provider ?? ""),
  );
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">{t("characterBriefing.title")}</h2>
        <p className="text-sm text-[var(--muted-foreground)]">{t("characterBriefing.help")}</p>
      </div>
      <label className="block space-y-1.5 text-sm font-medium">
        {t("characterBriefing.sourceTemplate")}
        <textarea
          ref={textareaRef}
          value={source}
          onChange={(event) => {
            setSource(event.target.value);
            setCaret(event.target.selectionStart ?? 0);
          }}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
          rows={12}
          className="w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--secondary)] p-3 font-mono text-sm"
        />
      </label>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2 rounded-lg border border-[var(--border)] p-2 text-xs">
          {suggestions.map((item) => (
            <button
              type="button"
              key={`${item.type}:${item.id}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => insertSuggestion(item)}
              className="rounded-md bg-[var(--accent)] px-2 py-1"
            >
              {t(`characterBriefing.${item.type}`)}: {item.label}
            </button>
          ))}
        </div>
      )}
      <label className="block space-y-1.5 text-sm font-medium">
        {t("characterBriefing.connection")}
        <select
          value={connectionId}
          onChange={(event) => setConnectionId(event.target.value)}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] p-2"
        >
          <option value="">{t("characterBriefing.defaultConnection")}</option>
          {languageConnections.map((item) => (
            <option key={item.id} value={item.id}>
              {item.model
                ? t("characterBriefing.connectionWithModel", { name: item.name, model: item.model })
                : item.name}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={save.isPending || generate.isPending}
          onClick={() => void persist()}
          className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
        >
          {save.isPending ? <Loader2 className="animate-spin" size="0.9rem" /> : <Save size="0.9rem" />}
          {t("characterBriefing.save")}
        </button>
        <button
          type="button"
          disabled={save.isPending || generate.isPending}
          onClick={() => void runGeneration()}
          className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-3 py-2 text-sm text-white"
        >
          {generate.isPending ? <Loader2 className="animate-spin" size="0.9rem" /> : <Sparkles size="0.9rem" />}
          {t("characterBriefing.generate")}
        </button>
      </div>
      <section className="space-y-1.5">
        <h3 className="text-sm font-semibold">{t("characterBriefing.latest")}</h3>
        {state?.latestBriefing ? (
          <pre className="whitespace-pre-wrap rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 text-sm">
            {state.latestBriefing}
          </pre>
        ) : (
          <p className="rounded-xl border border-dashed border-[var(--border)] p-3 text-sm text-[var(--muted-foreground)]">
            {t("characterBriefing.empty")}
          </p>
        )}
        {state?.latestGeneratedAt && (
          <p className="text-xs text-[var(--muted-foreground)]">
            {t("characterBriefing.lastGenerated", { date: new Date(state.latestGeneratedAt).toLocaleString() })}
          </p>
        )}
      </section>
    </div>
  );
}
