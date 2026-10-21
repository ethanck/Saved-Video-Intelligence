import type {
  CaptureRecord,
  GitHubRepositoryCandidate,
  GitHubRepositoryDiscoveryRecord,
  RepositoryEvidence,
  RepositoryEvidenceKind,
  RepositoryEvidenceSource,
  TranscriptRecord,
} from "@svi/shared-types";

const githubRepositoryUrlPattern = /\bhttps?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/gi;
const explicitRepositoryPattern = /\b(?:github(?:\.com)?|repo(?:sitory)?)\s*(?:is|at|on|:)?\s*([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\b/gi;
const githubReservedOwners = new Set(["features", "marketplace", "orgs", "search", "settings", "sponsors", "topics"]);
const stopWords = new Set([
  "about", "after", "also", "and", "are", "because", "build", "building", "called", "code", "from",
  "github", "have", "how", "into", "its", "just", "library", "more", "need", "project", "repo",
  "repository", "search", "that", "their", "this", "using", "what", "with", "you",
]);

export type GitHubRepositorySearchResult = {
  fullName: string;
  owner: string;
  name: string;
  url: string;
  description?: string;
  stars?: number;
};

export interface GitHubRepositorySearcher {
  searchRepositories(query: string): Promise<GitHubRepositorySearchResult[]>;
}

export type GitHubRepositorySearcherOptions = {
  token?: string;
  fetchImpl?: typeof fetch;
  maxResults?: number;
};

/** Minimal GitHub REST adapter. Credentials stay in the worker environment. */
export class GitHubApiRepositorySearcher implements GitHubRepositorySearcher {
  private readonly fetchImpl: typeof fetch;
  private readonly token: string | undefined;
  private readonly maxResults: number;

  constructor(options: GitHubRepositorySearcherOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.token = options.token;
    this.maxResults = Math.min(Math.max(options.maxResults ?? 5, 1), 10);
  }

  async searchRepositories(query: string): Promise<GitHubRepositorySearchResult[]> {
    const requestUrl = new URL("https://api.github.com/search/repositories");
    requestUrl.searchParams.set("q", query);
    requestUrl.searchParams.set("per_page", String(this.maxResults));

    const headers = new Headers({
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "saved-video-intelligence-repository-discovery",
    });
    if (this.token) headers.set("authorization", `Bearer ${this.token}`);

    const response = await this.fetchImpl(requestUrl, { headers });
    if (!response.ok) {
      throw new Error(`GitHub repository search failed with status ${response.status}.`);
    }

    const body = await response.json() as { items?: unknown };
    if (!Array.isArray(body.items)) return [];

    return body.items.flatMap((item) => normalizeSearchResult(item)).slice(0, this.maxResults);
  }
}

export type RepositoryDiscoveryInput = {
  capture: CaptureRecord;
  transcript?: TranscriptRecord;
};

export type RepositoryDiscoveryOptions = {
  maxQueries?: number;
  maxCandidates?: number;
};

/**
 * Extracts explicit references first, then uses short contextual queries. It
 * never sends the full transcript to GitHub and keeps every suggestion tied to
 * source evidence for later user confirmation.
 */
export class GitHubRepositoryDiscoveryEngine {
  private readonly maxQueries: number;
  private readonly maxCandidates: number;

  constructor(
    private readonly searcher: GitHubRepositorySearcher,
    options: RepositoryDiscoveryOptions = {},
  ) {
    this.maxQueries = Math.min(Math.max(options.maxQueries ?? 5, 1), 10);
    this.maxCandidates = Math.min(Math.max(options.maxCandidates ?? 10, 1), 20);
  }

  async discover(input: RepositoryDiscoveryInput, now = new Date()): Promise<GitHubRepositoryDiscoveryRecord> {
    const evidenceByRepository = collectExplicitEvidence(input);
    const queries = buildSearchQueries(input, evidenceByRepository).slice(0, this.maxQueries);
    const errors: string[] = [];
    const candidates = new Map<string, GitHubRepositoryCandidate>();

    for (const [fullName, evidence] of evidenceByRepository) {
      const [owner, name] = fullName.split("/") as [string, string];
      candidates.set(fullName, candidateFromExplicitReference(owner, name, evidence));
    }

    for (const query of queries) {
      try {
        const results = await this.searcher.searchRepositories(query);
        for (const result of results) {
          const candidate = rankSearchResult(result, query, input, evidenceByRepository);
          if (candidate.confidence < 0.25) continue;
          const candidateKey = canonicalRepositoryKey(candidate.fullName);
          const existing = candidates.get(candidateKey);
          candidates.set(candidateKey, existing ? mergeCandidates(existing, candidate) : candidate);
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "GitHub repository search failed.");
      }
    }

    const orderedCandidates = [...candidates.values()]
      .sort((left, right) => right.confidence - left.confidence || (right.stars ?? 0) - (left.stars ?? 0))
      .slice(0, this.maxCandidates);
    const topCandidate = orderedCandidates[0];
    const hasDirectUrl = topCandidate?.evidence.some((item) => item.kind === "direct_url") ?? false;
    const status = orderedCandidates.length === 0
      ? errors.length > 0 ? "needs_review" : "not_found"
      : topCandidate!.confidence >= 0.8 && (errors.length === 0 || hasDirectUrl)
        ? "found"
        : "needs_review";
    const timestamp = now.toISOString();

    return {
      captureId: input.capture.id,
      userId: input.capture.userId,
      status,
      selectionStatus: "unreviewed",
      candidates: orderedCandidates,
      queries,
      provider: "github-repository-search-v1",
      ...(errors.length > 0 ? { errors } : {}),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }
}

export function normalizeGitHubRepositoryReference(value: string): { fullName: string; owner: string; name: string } | undefined {
  const normalized = value.trim().replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
  const [owner, name] = normalized.split("/") as [string | undefined, string | undefined];
  if (!owner || !name || githubReservedOwners.has(owner.toLowerCase())) return undefined;
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(owner) || !/^[A-Za-z0-9_.-]{1,100}$/.test(name)) return undefined;
  return { fullName: `${owner}/${name}`, owner, name };
}

type DiscoveryText = {
  source: RepositoryEvidenceSource;
  text: string;
  startMs?: number;
  endMs?: number;
};

function collectExplicitEvidence(input: RepositoryDiscoveryInput): Map<string, RepositoryEvidence[]> {
  const references = new Map<string, RepositoryEvidence[]>();
  for (const text of discoveryTexts(input)) {
    for (const match of text.text.matchAll(githubRepositoryUrlPattern)) {
      const reference = normalizeGitHubRepositoryReference(`${match[1]}/${match[2]}`);
      if (reference) addEvidence(references, reference.fullName, {
        kind: "direct_url",
        source: text.source,
        value: `https://github.com/${reference.fullName}`,
        excerpt: excerptAround(text.text, match.index ?? 0),
        ...(text.startMs === undefined ? {} : { startMs: text.startMs }),
        ...(text.endMs === undefined ? {} : { endMs: text.endMs }),
      });
    }
    for (const match of text.text.matchAll(explicitRepositoryPattern)) {
      const reference = normalizeGitHubRepositoryReference(match[1] ?? "");
      if (reference) addEvidence(references, reference.fullName, {
        kind: "explicit_slug",
        source: text.source,
        value: reference.fullName,
        excerpt: excerptAround(text.text, match.index ?? 0),
        ...(text.startMs === undefined ? {} : { startMs: text.startMs }),
        ...(text.endMs === undefined ? {} : { endMs: text.endMs }),
      });
    }
  }
  return references;
}

function buildSearchQueries(
  input: RepositoryDiscoveryInput,
  explicit: Map<string, RepositoryEvidence[]>,
): string[] {
  const queries = [...explicit.keys()];
  const contextTexts = discoveryTexts(input)
    .filter((item) => item.source !== "original_url")
    .map((item) => item.text)
    .flatMap((text) => text.split(/[.!?\n]+/))
    .filter((text) => /\b(github|repo(?:sitory)?|project|library|framework|code)\b/i.test(text));

  const broadContext = [input.capture.title, input.capture.caption, input.capture.metadata?.title]
    .filter((value): value is string => Boolean(value))
    .join(" ");
  if (broadContext) queries.push(toSearchQuery(broadContext));
  for (const text of contextTexts.slice(0, 3)) queries.push(toSearchQuery(text));

  return [...new Set(queries.filter((query) => query.length >= 3))];
}

function discoveryTexts(input: RepositoryDiscoveryInput): DiscoveryText[] {
  const texts: DiscoveryText[] = [];
  if (input.capture.originalUrl) texts.push({ source: "original_url", text: input.capture.originalUrl });
  if (input.capture.title) texts.push({ source: "title", text: input.capture.title });
  if (input.capture.caption) texts.push({ source: "caption", text: input.capture.caption });
  if (input.capture.metadata?.title) texts.push({ source: "metadata", text: input.capture.metadata.title });
  if (input.capture.metadata?.description) texts.push({ source: "metadata", text: input.capture.metadata.description });
  if (input.transcript) {
    if (input.transcript.segments.length > 0) {
      texts.push(...input.transcript.segments.map((segment) => ({
        source: "transcript" as const,
        text: segment.text,
        startMs: segment.startMs,
        endMs: segment.endMs,
      })));
    } else {
      texts.push({ source: "transcript", text: input.transcript.text });
    }
  }
  return texts;
}

function candidateFromExplicitReference(owner: string, name: string, evidence: RepositoryEvidence[]): GitHubRepositoryCandidate {
  return {
    fullName: `${owner}/${name}`,
    owner,
    name,
    url: `https://github.com/${owner}/${name}`,
    confidence: evidence.some((item) => item.kind === "direct_url") ? 1 : 0.95,
    matchReasons: evidence.some((item) => item.kind === "direct_url") ? ["Direct GitHub URL found in source."] : ["Explicit repository slug found in source."],
    evidence,
  };
}

function rankSearchResult(
  result: GitHubRepositorySearchResult,
  query: string,
  input: RepositoryDiscoveryInput,
  explicit: Map<string, RepositoryEvidence[]>,
): GitHubRepositoryCandidate {
  const exactEvidence = explicit.get(canonicalRepositoryKey(result.fullName));
  const queryTokens = tokenize(query);
  const resultTokens = tokenize(`${result.fullName} ${result.description ?? ""}`);
  const overlap = [...queryTokens].filter((token: string) => resultTokens.has(token)).length / Math.max(queryTokens.size, 1);
  const titleTokens = tokenize(`${input.capture.title ?? ""} ${input.capture.metadata?.title ?? ""}`);
  const titleOverlap = [...titleTokens].filter((token: string) => resultTokens.has(token)).length / Math.max(titleTokens.size, 1);
  const confidence = exactEvidence
    ? exactEvidence.some((item) => item.kind === "direct_url") ? 1 : 0.95
    : Math.min(0.79, 0.28 + overlap * 0.38 + titleOverlap * 0.25);
  const source = input.transcript?.text.includes(query) ? "transcript" : input.capture.title ? "title" : "metadata";
  const evidence: RepositoryEvidence[] = exactEvidence ?? [{
    kind: "context_search",
    source,
    value: query,
    excerpt: query,
  }];

  return {
    fullName: result.fullName,
    owner: result.owner,
    name: result.name,
    url: result.url,
    ...(result.description ? { description: result.description.slice(0, 1000) } : {}),
    ...(result.stars === undefined ? {} : { stars: result.stars }),
    confidence: roundConfidence(confidence),
    matchReasons: [
      overlap > 0 ? "Repository name or description overlaps the source context." : "Returned by GitHub contextual search.",
      ...(titleOverlap > 0 ? ["Repository overlaps the capture title or metadata title."] : []),
    ],
    evidence,
  };
}

function mergeCandidates(left: GitHubRepositoryCandidate, right: GitHubRepositoryCandidate): GitHubRepositoryCandidate {
  return {
    ...left,
    ...right,
    confidence: Math.max(left.confidence, right.confidence),
    matchReasons: [...new Set([...left.matchReasons, ...right.matchReasons])],
    evidence: [...left.evidence, ...right.evidence].filter((evidence, index, all) => all.findIndex((item) => JSON.stringify(item) === JSON.stringify(evidence)) === index),
  };
}

function addEvidence(map: Map<string, RepositoryEvidence[]>, fullName: string, evidence: RepositoryEvidence): void {
  const key = canonicalRepositoryKey(fullName);
  const current = map.get(key) ?? [];
  if (!current.some((item) => item.kind === evidence.kind && item.source === evidence.source && item.value === evidence.value)) {
    current.push(evidence);
  }
  map.set(key, current);
}

function canonicalRepositoryKey(fullName: string): string {
  return fullName.toLowerCase();
}

function normalizeSearchResult(value: unknown): GitHubRepositorySearchResult[] {
  if (!value || typeof value !== "object") return [];
  const item = value as Record<string, unknown>;
  const fullName = typeof item.full_name === "string" ? item.full_name : undefined;
  const url = typeof item.html_url === "string" ? item.html_url : undefined;
  const name = typeof item.name === "string" ? item.name : undefined;
  const owner = item.owner && typeof item.owner === "object" && typeof (item.owner as Record<string, unknown>).login === "string"
    ? (item.owner as Record<string, unknown>).login as string
    : undefined;
  if (!fullName || !url || !name || !owner || !normalizeGitHubRepositoryReference(fullName)) return [];
  return [{
    fullName,
    owner,
    name,
    url,
    ...(typeof item.description === "string" ? { description: item.description } : {}),
    ...(typeof item.stargazers_count === "number" ? { stars: item.stargazers_count } : {}),
  }];
}

function toSearchQuery(text: string): string {
  return [...tokenize(text)].slice(0, 10).join(" ").slice(0, 160);
}

function tokenize(value: string): Set<string> {
  return new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 3 && !stopWords.has(token)));
}

function excerptAround(text: string, index: number): string {
  return text.slice(Math.max(0, index - 80), Math.min(text.length, index + 180)).trim();
}

function roundConfidence(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
}
