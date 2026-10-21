import assert from "node:assert/strict";
import test from "node:test";
import type { CaptureRecord, CaptureStage, ProcessingJob } from "@svi/shared-types";
import { PipelineWorker } from "../workers/pipeline-worker/src/index.js";

class WorkerRepository {
  constructor(
    public capture: CaptureRecord,
    public job: ProcessingJob,
  ) {}

  async claimNextQueuedJob(stage: CaptureStage) {
    if (this.job.status !== "queued" || this.job.stage !== stage) return undefined;
    this.job = { ...this.job, status: "running" };
    return this.job;
  }

  async getCapture() {
    return this.capture;
  }

  async updateCapture(capture: CaptureRecord) {
    this.capture = capture;
    return capture;
  }

  async updateJob(job: ProcessingJob) {
    this.job = job;
    return job;
  }
}

function fixture() {
  const capture: CaptureRecord = {
    id: "capture-1",
    userId: "user-1",
    originalUrl: "https://example.com/video",
    platform: "web",
    status: "extracting_media",
    currentStage: "extracting_media",
    retryCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const job: ProcessingJob = {
    id: "job-1",
    captureId: capture.id,
    userId: capture.userId,
    status: "queued",
    stage: "extracting_media",
    retryCount: 0,
    createdAt: capture.createdAt,
    updatedAt: capture.updatedAt,
  };
  return { capture, job };
}

test("pipeline worker queues the next stage without fabricating output", async () => {
  const { capture, job } = fixture();
  const repository = new WorkerRepository(capture, job);
  const worker = new PipelineWorker(repository, "extracting_media", {
    process: async () => ({ kind: "advance" as const }),
  });

  const result = await worker.runOnce(new Date("2026-01-01T01:00:00.000Z"));

  assert.deepEqual(result, { processed: true, captureId: capture.id, nextStage: "transcribing" });
  assert.equal(repository.capture.status, "transcribing");
  assert.equal(repository.job.status, "queued");
  assert.equal(repository.job.stage, "transcribing");
});

test("pipeline worker preserves the source and routes review results", async () => {
  const { capture, job } = fixture();
  const repository = new WorkerRepository(capture, job);
  const worker = new PipelineWorker(repository, "extracting_media", {
    process: async () => ({ kind: "needs_review" as const, reason: "Source requires manual review." }),
  });

  const result = await worker.runOnce(new Date("2026-01-01T01:00:00.000Z"));

  assert.deepEqual(result, { processed: true, captureId: capture.id, nextStage: "needs_review" });
  assert.equal(repository.capture.originalUrl, capture.originalUrl);
  assert.equal(repository.capture.status, "needs_review");
  assert.equal(repository.capture.reviewReason, "Source requires manual review.");
  assert.equal(repository.job.status, "completed");
});

test("pipeline worker records provider failures as failed jobs", async () => {
  const { capture, job } = fixture();
  const repository = new WorkerRepository(capture, job);
  const worker = new PipelineWorker(repository, "extracting_media", {
    process: async () => { throw new Error("permitted source unavailable"); },
  });

  const result = await worker.runOnce(new Date("2026-01-01T01:00:00.000Z"));

  assert.deepEqual(result, { processed: true, captureId: capture.id, nextStage: "failed", errorMessage: "permitted source unavailable" });
  assert.equal(repository.capture.originalUrl, capture.originalUrl);
  assert.equal(repository.capture.status, "failed");
  assert.equal(repository.job.status, "failed");
});
