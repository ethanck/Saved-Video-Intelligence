/** Provider-neutral contracts for the backend processing pipeline. */
import type {
  CaptureRecord,
  CaptureStage,
  ProcessingJob,
  TranscriptAttempt,
  TranscriptRecord,
  TranscriptSegment,
  TranscriptSource,
} from "@svi/shared-types";

/** Stages that require a backend provider or worker implementation. */
export const processingStages = [
  "extracting_media",
  "transcribing",
  "discovering_repositories",
  "extracting_frames",
  "ocr",
  "summarizing",
  "classifying",
  "embedding",
] as const satisfies readonly CaptureStage[];

export type ProcessingStage = (typeof processingStages)[number];

/** The only valid forward transitions for the processing pipeline. */
export const nextStage: Record<ProcessingStage, CaptureStage> = {
  extracting_media: "transcribing",
  transcribing: "discovering_repositories",
  discovering_repositories: "extracting_frames",
  extracting_frames: "ocr",
  ocr: "summarizing",
  summarizing: "classifying",
  classifying: "embedding",
  embedding: "ready",
};

export type ProcessingContext = {
  capture: CaptureRecord;
  job: ProcessingJob;
};

/** Provider output that may be persisted on the capture by the worker. */
export type ProcessingOutput = {
  kind: "advance";
  patch?: Partial<CaptureRecord>;
};

/** A provider can route an item to human review without fabricating completion. */
export type ReviewOutput = {
  kind: "needs_review";
  reason: string;
  patch?: Partial<CaptureRecord>;
};

export type ProcessingResult = ProcessingOutput | ReviewOutput;

export * from "./github-repository-discovery.js";

/** One stage implementation. Providers run only on the backend. */
export interface ProcessingStageHandler {
  process(context: ProcessingContext): Promise<ProcessingResult>;
}

/** The storage operations required by any local or hosted pipeline worker. */
export interface PipelineRepository {
  claimNextQueuedJob(stage: CaptureStage): Promise<ProcessingJob | undefined>;
  getCapture(userId: string, captureId: string): Promise<CaptureRecord | undefined>;
  updateCapture(capture: CaptureRecord): Promise<CaptureRecord>;
  updateJob(job: ProcessingJob): Promise<ProcessingJob>;
}

export type TranscriptInput = {
  capture: CaptureRecord;
};

export type TranscriptCandidate = {
  text: string;
  segments?: TranscriptSegment[];
  source: TranscriptSource;
  provider: string;
  confidence?: number;
};

/** One permitted backend method for obtaining a transcript. */
export interface TranscriptProvider {
  readonly method: string;
  readonly provider: string;
  transcribe(input: TranscriptInput): Promise<TranscriptCandidate>;
}

export type TranscriptChainResult =
  | { kind: "success"; transcript: TranscriptRecord }
  | { kind: "needs_review"; attempts: TranscriptAttempt[]; reason: string };

/**
 * Try transcript methods in order and retain an audit record for every attempt.
 * Providers must only access sources they are permitted to access.
 */
export class TranscriptFallbackChain {
  constructor(private readonly providers: readonly TranscriptProvider[]) {}

  async run(input: TranscriptInput, now = new Date()): Promise<TranscriptChainResult> {
    const attempts: TranscriptAttempt[] = [];

    for (const provider of this.providers) {
      const startedAt = new Date().toISOString();
      try {
        const candidate = await provider.transcribe(input);
        const completedAt = new Date().toISOString();
        if (!candidate.text.trim()) throw new Error("Provider returned an empty transcript.");
        attempts.push({
          method: provider.method,
          provider: provider.provider,
          status: "succeeded",
          startedAt,
          completedAt,
        });
        const timestamp = now.toISOString();
        return {
          kind: "success",
          transcript: {
            captureId: input.capture.id,
            userId: input.capture.userId,
            text: candidate.text.trim(),
            segments: candidate.segments ?? [],
            source: candidate.source,
            provider: candidate.provider,
            ...(candidate.confidence === undefined ? {} : { confidence: candidate.confidence }),
            attempts,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        };
      } catch (error) {
        const completedAt = new Date().toISOString();
        attempts.push({
          method: provider.method,
          provider: provider.provider,
          status: "failed",
          startedAt,
          completedAt,
          errorMessage: error instanceof Error ? error.message : "Transcript provider failed.",
        });
      }
    }

    return {
      kind: "needs_review",
      attempts,
      reason: attempts.length > 0
        ? "All permitted transcript methods failed. Add a manual transcript or retry later."
        : "No transcript methods are configured. Add a manual transcript or configure a backend provider.",
    };
  }
}
