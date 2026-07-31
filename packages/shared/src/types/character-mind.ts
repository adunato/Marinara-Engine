export type CharacterMindOperationName = "build" | "sync" | "ingest" | "query" | "lint";

export interface CharacterMindPagePlan {
  path: string;
  title: string;
  purpose: string;
  sources: string[];
}

export interface CharacterMindExcludedSource {
  path: string;
  reason: string;
}

export interface CharacterMindPlanResult {
  summary: string;
  pages: CharacterMindPagePlan[];
  excludedSources: CharacterMindExcludedSource[];
}

export interface CharacterMindIngestResult {
  summary: string;
  created: string[];
  updated: string[];
}

export interface CharacterMindQueryResult {
  briefing: string;
  wikiPages: string[];
  rawSources: string[];
}

export interface CharacterMindLintResult {
  summary: string;
  findings: string[];
  changed: string[];
}

export interface CharacterMindStatus {
  initialized: boolean;
  built: boolean;
  path: string | null;
  currentRevisions: string[];
  pendingSources: string[];
  activeOperation: { name: CharacterMindOperationName; startedAt: string } | null;
  lastLogEntry: { operation: string; timestamp: string; status: "success" | "failure" } | null;
}

export interface CharacterMindSourceRun {
  source: string;
  result: CharacterMindIngestResult | null;
  error: string | null;
}

export interface CharacterMindBuildOrSyncResult {
  snapshotsCreated: string[];
  processed: CharacterMindSourceRun[];
  pendingSources: string[];
}

export interface CharacterMindCancelResult {
  cancelled: boolean;
  operation: CharacterMindOperationName | null;
}

export interface CharacterMindQueryRequest {
  query: string;
}

export interface CharacterMindSyncRequest {
  maxSources?: number;
}
