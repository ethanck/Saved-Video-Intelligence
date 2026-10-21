/** Processing stages shared by the API, mobile app, and web build. */
export const captureStages = [
  "received",
  "deduplicating",
  "fetching_metadata",
  "extracting_media",
  "transcribing",
  "discovering_repositories",
  "extracting_frames",
  "ocr",
  "summarizing",
  "classifying",
  "embedding",
  "ready",
  "needs_review",
  "failed",
] as const;

export type CaptureStage = (typeof captureStages)[number];

/** Where the eventual transcript came from, including unavailable-source cases. */
export type TranscriptSource =
  | "metadata"
  | "captions"
  | "downloaded_media"
  | "user_upload"
  | "manual"
  | "failed_unavailable";

/** User-provided values accepted by the API and native share extension. */
export type CaptureInput = {
  url?: string;
  text?: string;
  title?: string;
  caption?: string;
  sourceApp?: string;
};

/** Metadata discovered from a public source before media processing. */
export type SourceMetadata = {
  canonicalUrl?: string;
  title?: string;
  description?: string;
  author?: string;
  thumbnailUrl?: string;
  publishedAt?: string;
  /** Public caption/WebVTT track discovered from the source page, if available. */
  captionsUrl?: string;
};

/** One timestamped section of a persisted transcript. */
export type TranscriptSegment = {
  startMs: number;
  endMs: number;
  text: string;
};

/** Auditable outcome for one transcript method attempt. */
export type TranscriptAttempt = {
  method: string;
  provider: string;
  status: "succeeded" | "failed";
  startedAt: string;
  completedAt: string;
  errorMessage?: string;
};

/** User-owned transcript stored separately from the capture document. */
export type TranscriptRecord = {
  captureId: string;
  userId: string;
  text: string;
  segments: TranscriptSegment[];
  source: TranscriptSource;
  provider: string;
  confidence?: number;
  attempts: TranscriptAttempt[];
  createdAt: string;
  updatedAt: string;
};

export type RepositoryEvidenceSource = "original_url" | "title" | "caption" | "metadata" | "transcript";

export type RepositoryEvidenceKind = "direct_url" | "explicit_slug" | "context_search";

/** Provenance explaining why a GitHub repository was suggested. */
export type RepositoryEvidence = {
  kind: RepositoryEvidenceKind;
  source: RepositoryEvidenceSource;
  value: string;
  excerpt?: string;
  startMs?: number;
  endMs?: number;
};

/** One normalized GitHub repository candidate, never an unverified assertion. */
export type GitHubRepositoryCandidate = {
  fullName: string;
  owner: string;
  name: string;
  url: string;
  description?: string;
  stars?: number;
  confidence: number;
  matchReasons: string[];
  evidence: RepositoryEvidence[];
};

export type GitHubRepositoryDiscoveryStatus = "found" | "needs_review" | "not_found";
export type GitHubRepositorySelectionStatus = "unreviewed" | "accepted" | "rejected";

/** User-owned, provenance-preserving GitHub discovery output for one capture. */
export type GitHubRepositoryDiscoveryRecord = {
  captureId: string;
  userId: string;
  status: GitHubRepositoryDiscoveryStatus;
  selectionStatus: GitHubRepositorySelectionStatus;
  candidates: GitHubRepositoryCandidate[];
  queries: string[];
  provider: string;
  errors?: string[];
  selectedFullName?: string;
  reviewedAt?: string;
  createdAt: string;
  updatedAt: string;
};

/** Durable user-owned record displayed in the mobile/web Inbox. */
export type CaptureRecord = {
  id: string;
  userId: string;
  originalUrl?: string;
  platform: string;
  title?: string;
  caption?: string;
  sourceApp?: string;
  metadata?: SourceMetadata;
  status: CaptureStage;
  currentStage: CaptureStage;
  retryCount: number;
  errorMessage?: string;
  reviewReason?: string;
  transcriptSource?: TranscriptSource;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

/** Queue state for one capture-processing attempt. */
export type ProcessingJob = {
  id: string;
  captureId: string;
  userId: string;
  status: "queued" | "running" | "completed" | "failed";
  stage: CaptureStage;
  retryCount: number;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
};

/** Development persistence shape used by the JSON repository. */
export type LocalStore = {
  captures: CaptureRecord[];
  jobs: ProcessingJob[];
  transcripts: TranscriptRecord[];
  githubRepositoryDiscoveries: GitHubRepositoryDiscoveryRecord[];
};
