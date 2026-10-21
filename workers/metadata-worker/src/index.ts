/** Worker orchestration for the first metadata stage of capture processing. */
import type { MetadataExtractor } from "@svi/ingestion";
import type { CaptureRecord, CaptureStage, ProcessingJob } from "@svi/shared-types";
import { NoopProcessingQueue, type ProcessingQueue } from "../../../packages/processing/src/queue.js";

/** Minimal repository contract so workers do not depend on the HTTP application. */
export interface ProcessingRepository {
  claimNextQueuedJob(stage: CaptureStage): Promise<ProcessingJob | undefined>;
  getCapture(userId: string, captureId: string): Promise<CaptureRecord | undefined>;
  updateCapture(capture: CaptureRecord): Promise<CaptureRecord>;
  updateJob(job: ProcessingJob): Promise<ProcessingJob>;
}

export type MetadataWorkerResult =
  | { processed: false }
  | { processed: true; captureId: string; nextStage: CaptureStage }
  | { processed: true; captureId: string; nextStage: "failed"; errorMessage: string };

/**
 * Advances only the metadata stage. The next stage remains queued until its
 * dedicated worker exists, so this worker cannot accidentally mark a capture ready.
 */
export class MetadataWorker {
  constructor(
    private readonly repository: ProcessingRepository,
    private readonly extractor: MetadataExtractor,
    private readonly queue: ProcessingQueue = new NoopProcessingQueue(),
  ) {}

  async runOnce(now = new Date()): Promise<MetadataWorkerResult> {
    const job = await this.repository.claimNextQueuedJob("received");
    if (!job) return { processed: false };

    const capture = await this.repository.getCapture(job.userId, job.captureId);
    if (!capture) {
      const message = "Capture for queued job was not found.";
      await this.repository.updateJob({ ...job, status: "failed", errorMessage: message, updatedAt: now.toISOString() });
      return { processed: true, captureId: job.captureId, nextStage: "failed", errorMessage: message };
    }

    const startedAt = now.toISOString();
    await this.repository.updateCapture({ ...capture, status: "fetching_metadata", currentStage: "fetching_metadata", updatedAt: startedAt });

    try {
      const metadata = capture.originalUrl
        ? await this.extractor.extract({ url: capture.originalUrl, platform: capture.platform })
        : {};
      const { errorMessage: _errorMessage, completedAt: _completedAt, reviewReason: _reviewReason, ...captureWithoutTerminalState } = capture;
      const nextStage: CaptureStage = metadata.captionsUrl ? "transcribing" : "needs_review";
      const updatedCapture: CaptureRecord = {
        ...captureWithoutTerminalState,
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
        ...(capture.title || !metadata.title ? {} : { title: metadata.title }),
        status: nextStage,
        currentStage: nextStage,
        updatedAt: now.toISOString(),
        ...(nextStage === "needs_review" ? { reviewReason: "No public caption track was found. Add a manual transcript to continue." } : {}),
      };
      const { errorMessage: _jobError, ...jobWithoutError } = job;
      const nextJob: ProcessingJob = {
        ...jobWithoutError,
        status: nextStage === "needs_review" ? "completed" : "queued",
        stage: nextStage,
        updatedAt: now.toISOString(),
      };
      await this.repository.updateCapture(updatedCapture);
      await this.repository.updateJob(nextJob);
      if (nextJob.status === "queued") await enqueueWithoutBlocking(this.queue, nextJob);
      return { processed: true, captureId: capture.id, nextStage };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Metadata extraction failed.";
      const failedAt = now.toISOString();
      await this.repository.updateCapture({
        ...capture,
        status: "failed",
        currentStage: "failed",
        errorMessage: message,
        updatedAt: failedAt,
      });
      await this.repository.updateJob({ ...job, status: "failed", stage: "failed", errorMessage: message, updatedAt: failedAt });
      return { processed: true, captureId: capture.id, nextStage: "failed", errorMessage: message };
    }
  }
}

/** Keep a durable queued job available when managed dispatch is unavailable. */
async function enqueueWithoutBlocking(queue: ProcessingQueue, job: ProcessingJob): Promise<void> {
  try {
    await queue.enqueue(job);
  } catch (error) {
    console.error(`Could not dispatch processing job ${job.id}; it remains queued for reconciliation.`, error);
  }
}
