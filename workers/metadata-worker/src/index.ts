/** Worker orchestration for the first metadata stage of capture processing. */
import type { MetadataExtractor } from "@svi/ingestion";
import type { CaptureRecord, CaptureStage, ProcessingJob } from "@svi/shared-types";

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
      const { errorMessage: _errorMessage, completedAt: _completedAt, ...captureWithoutTerminalState } = capture;
      const updatedCapture: CaptureRecord = {
        ...captureWithoutTerminalState,
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
        ...(capture.title || !metadata.title ? {} : { title: metadata.title }),
        status: "extracting_media",
        currentStage: "extracting_media",
        updatedAt: now.toISOString(),
      };
      const { errorMessage: _jobError, ...jobWithoutError } = job;
      const nextJob: ProcessingJob = {
        ...jobWithoutError,
        status: "queued",
        stage: "extracting_media",
        updatedAt: now.toISOString(),
      };
      await this.repository.updateCapture(updatedCapture);
      await this.repository.updateJob(nextJob);
      return { processed: true, captureId: capture.id, nextStage: "extracting_media" };
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
