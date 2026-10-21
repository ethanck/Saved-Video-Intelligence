/** Generic one-stage-at-a-time worker for backend processing stages. */
import type { CaptureRecord, CaptureStage, ProcessingJob } from "@svi/shared-types";
import {
  nextStage,
  type PipelineRepository,
  type ProcessingResult,
  type ProcessingStage,
  type ProcessingStageHandler,
} from "../../../packages/processing/src/index.js";

export type PipelineWorkerResult =
  | { processed: false }
  | { processed: true; captureId: string; nextStage: CaptureStage }
  | { processed: true; captureId: string; nextStage: "failed"; errorMessage: string };

/**
 * Claims one job for a specific stage, invokes that stage's provider, and
 * queues exactly one forward transition. It never marks an item ready itself;
 * only the final embedding stage can transition to `ready`.
 */
export class PipelineWorker {
  constructor(
    private readonly repository: PipelineRepository,
    private readonly stage: ProcessingStage,
    private readonly handler: ProcessingStageHandler,
  ) {}

  async runOnce(now = new Date()): Promise<PipelineWorkerResult> {
    const job = await this.repository.claimNextQueuedJob(this.stage);
    if (!job) return { processed: false };

    const capture = await this.repository.getCapture(job.userId, job.captureId);
    if (!capture) {
      const message = "Capture for queued job was not found.";
      await this.repository.updateJob(failedJob(job, message, now));
      return { processed: true, captureId: job.captureId, nextStage: "failed", errorMessage: message };
    }

    const startedAt = now.toISOString();
    await this.repository.updateCapture({
      ...withoutTransientState(capture),
      status: this.stage,
      currentStage: this.stage,
      updatedAt: startedAt,
    });

    try {
      const result = await this.handler.process({ capture, job });
      if (result.kind === "needs_review") {
        const reviewedCapture: CaptureRecord = {
          ...withoutTransientState(capture),
          ...result.patch,
          status: "needs_review",
          currentStage: "needs_review",
          reviewReason: result.reason,
          updatedAt: now.toISOString(),
        };
        await this.repository.updateCapture(reviewedCapture);
        await this.repository.updateJob({
          ...withoutJobError(job),
          status: "completed",
          stage: "needs_review",
          updatedAt: now.toISOString(),
        });
        return { processed: true, captureId: capture.id, nextStage: "needs_review" };
      }

      return await this.advance(job, capture, result, now);
    } catch (error) {
      const message = error instanceof Error ? error.message : `${this.stage} processing failed.`;
      await this.repository.updateCapture({
        ...capture,
        status: "failed",
        currentStage: "failed",
        errorMessage: message,
        updatedAt: now.toISOString(),
      });
      await this.repository.updateJob(failedJob(job, message, now));
      return { processed: true, captureId: capture.id, nextStage: "failed", errorMessage: message };
    }
  }

  private async advance(
    job: ProcessingJob,
    capture: CaptureRecord,
    result: ProcessingResult,
    now: Date,
  ): Promise<PipelineWorkerResult> {
    const targetStage = nextStage[this.stage];
    const updatedAt = now.toISOString();
    const nextCapture: CaptureRecord = {
      ...withoutTransientState(capture),
      ...result.patch,
      status: targetStage,
      currentStage: targetStage,
      updatedAt,
      ...(targetStage === "ready" ? { completedAt: updatedAt } : {}),
    };
    const nextJob: ProcessingJob = {
      ...withoutJobError(job),
      status: targetStage === "ready" ? "completed" : "queued",
      stage: targetStage,
      updatedAt,
    };
    await this.repository.updateCapture(nextCapture);
    await this.repository.updateJob(nextJob);
    return { processed: true, captureId: capture.id, nextStage: targetStage };
  }
}

function withoutTransientState(capture: CaptureRecord): Omit<CaptureRecord, "errorMessage" | "reviewReason" | "completedAt"> {
  const { errorMessage: _errorMessage, reviewReason: _reviewReason, completedAt: _completedAt, ...rest } = capture;
  return rest;
}

function withoutJobError(job: ProcessingJob): Omit<ProcessingJob, "errorMessage"> {
  const { errorMessage: _errorMessage, ...rest } = job;
  return rest;
}

function failedJob(job: ProcessingJob, message: string, now: Date): ProcessingJob {
  return {
    ...job,
    status: "failed",
    stage: "failed",
    errorMessage: message,
    updatedAt: now.toISOString(),
  };
}
