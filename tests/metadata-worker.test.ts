import assert from "node:assert/strict";
import test from "node:test";
import { PublicMetadataExtractor } from "../packages/ingestion/src/index.js";
import { MetadataWorker } from "../workers/metadata-worker/src/index.js";
import type { CaptureRecord, CaptureStage, ProcessingJob, SourceMetadata } from "@svi/shared-types";
import type { MetadataExtractor } from "@svi/ingestion";

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
    status: "received",
    currentStage: "received",
    retryCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const job: ProcessingJob = {
    id: "job-1",
    captureId: capture.id,
    userId: capture.userId,
    status: "queued",
    stage: "received",
    retryCount: 0,
    createdAt: capture.createdAt,
    updatedAt: capture.updatedAt,
  };
  return { capture, job };
}

test("metadata worker stores provider metadata and queues the next stage", async () => {
  const { capture, job } = fixture();
  const repository = new WorkerRepository(capture, job);
  const enqueued: ProcessingJob[] = [];
  const metadata: SourceMetadata = { title: "A useful video", description: "Metadata only" };
  const extractor: MetadataExtractor = { extract: async () => metadata };
  const worker = new MetadataWorker(repository, extractor, { enqueue: async (nextJob) => { enqueued.push(nextJob); } });

  const result = await worker.runOnce(new Date("2026-01-01T01:00:00.000Z"));

  assert.deepEqual(result, { processed: true, captureId: capture.id, nextStage: "extracting_media" });
  assert.equal(repository.capture.title, "A useful video");
  assert.deepEqual(repository.capture.metadata, metadata);
  assert.equal(repository.capture.status, "extracting_media");
  assert.equal(repository.job.status, "queued");
  assert.equal(repository.job.stage, "extracting_media");
  assert.equal(enqueued[0]?.id, job.id);
  assert.equal(enqueued[0]?.stage, "extracting_media");
});

test("metadata worker records failures without losing the source", async () => {
  const { capture, job } = fixture();
  const repository = new WorkerRepository(capture, job);
  const extractor: MetadataExtractor = { extract: async () => { throw new Error("source unavailable"); } };
  const worker = new MetadataWorker(repository, extractor);

  const result = await worker.runOnce(new Date("2026-01-01T01:00:00.000Z"));

  assert.deepEqual(result, { processed: true, captureId: capture.id, nextStage: "failed", errorMessage: "source unavailable" });
  assert.equal(repository.capture.originalUrl, capture.originalUrl);
  assert.equal(repository.capture.status, "failed");
  assert.equal(repository.job.status, "failed");
});

test("public metadata extractor reads lightweight HTML metadata without downloading media", async () => {
  let requestedInit: RequestInit | undefined;
  const extractor = new PublicMetadataExtractor({
    fetchImpl: async (_input, init) => {
      requestedInit = init;
      return new Response(`
        <html><head>
          <title>Fallback title</title>
          <meta property="og:title" content="A useful video &amp; demo">
          <meta name="description" content="A short description">
          <meta name="author" content="Example creator">
          <meta property="og:image" content="https://cdn.example.test/thumb.jpg">
          <link rel="canonical" href="https://example.com/canonical">
        </head></html>
      `, { headers: { "content-type": "text/html; charset=utf-8" } });
    },
  });

  const metadata = await extractor.extract({ url: "https://example.com/video", platform: "web" });

  assert.equal(metadata.title, "A useful video & demo");
  assert.equal(metadata.description, "A short description");
  assert.equal(metadata.author, "Example creator");
  assert.equal(metadata.thumbnailUrl, "https://cdn.example.test/thumb.jpg");
  assert.equal(metadata.canonicalUrl, "https://example.com/canonical");
  assert.equal(requestedInit?.method, "GET");
  assert.equal(requestedInit?.redirect, "manual");
  assert.match(String(new Headers(requestedInit?.headers).get("accept")), /text\/html/);
});

test("public metadata extractor rejects private-network URLs", async () => {
  let called = false;
  const extractor = new PublicMetadataExtractor({
    fetchImpl: async () => {
      called = true;
      return new Response("not called");
    },
  });

  await assert.rejects(extractor.extract({ url: "http://127.0.0.1:8787/health", platform: "web" }), /publicly reachable/);
  assert.equal(called, false);
});

