import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { buildServer } from "../apps/api/src/server.js";
import type { CaptureRecord, CaptureStage, ProcessingJob } from "../apps/api/src/domain.js";
import type { GitHubRepositoryDiscoveryRecord, TranscriptRecord } from "@svi/shared-types";
import type { KnowledgeRepository } from "../apps/api/src/repository.js";

/** In-memory repository keeps API tests deterministic and filesystem-free. */
class MemoryRepository implements KnowledgeRepository {
  captures: CaptureRecord[] = [];
  jobs: ProcessingJob[] = [];
  transcripts: TranscriptRecord[] = [];
  githubRepositoryDiscoveries: GitHubRepositoryDiscoveryRecord[] = [];

  async createCapture(capture: CaptureRecord) { this.captures.push(capture); return capture; }
  async getCapture(userId: string, captureId: string) { return this.captures.find((item) => item.userId === userId && item.id === captureId); }
  async listCaptures(userId: string, query?: string) {
    return this.captures.filter((item) => item.userId === userId && (!query || item.originalUrl?.includes(query)));
  }
  async updateCapture(capture: CaptureRecord) { const index = this.captures.findIndex((item) => item.id === capture.id); this.captures[index] = capture; return capture; }
  async createJob(job: ProcessingJob) { this.jobs.push(job); return job; }
  async listJobs(userId: string, captureId?: string) { return this.jobs.filter((job) => job.userId === userId && (!captureId || job.captureId === captureId)); }
  async saveTranscript(transcript: TranscriptRecord) { this.transcripts.push(transcript); return transcript; }
  async getTranscript(userId: string, captureId: string) { return this.transcripts.find((item) => item.userId === userId && item.captureId === captureId); }
  async saveGitHubRepositoryDiscovery(discovery: GitHubRepositoryDiscoveryRecord) {
    this.githubRepositoryDiscoveries = this.githubRepositoryDiscoveries.filter((item) => item.captureId !== discovery.captureId || item.userId !== discovery.userId);
    this.githubRepositoryDiscoveries.push(discovery);
    return discovery;
  }
  async getGitHubRepositoryDiscovery(userId: string, captureId: string) {
    return this.githubRepositoryDiscoveries.find((item) => item.userId === userId && item.captureId === captureId);
  }
  async claimNextQueuedJob(stage: CaptureStage) {
    const job = this.jobs.find((item) => item.status === "queued" && item.stage === stage);
    if (!job) return undefined;
    Object.assign(job, { status: "running" as const, updatedAt: new Date().toISOString() });
    return job;
  }
  async updateJob(job: ProcessingJob) { const index = this.jobs.findIndex((item) => item.id === job.id); this.jobs[index] = job; return job; }
}

async function request(server: ReturnType<typeof createServer>, path: string, init: RequestInit = {}) {
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return fetch(`http://127.0.0.1:${address.port}${path}`, {
    ...init,
    headers: { "content-type": "application/json", "x-user-id": "user-1", ...(init.headers ?? {}) },
  });
}

async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  server.closeAllConnections();
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

test("captures preserve the source and create a queued processing job", async () => {
  const repository = new MemoryRepository();
  const server = buildServer(repository);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const response = await request(server, "/v1/captures", {
      method: "POST",
      body: JSON.stringify({ text: "Save this https://www.youtube.com/watch?v=abc", title: "Test video" }),
    });
    const body = await response.json() as { capture: CaptureRecord; job: ProcessingJob };

    assert.equal(response.status, 202);
    assert.equal(body.capture.originalUrl, "https://www.youtube.com/watch?v=abc");
    assert.equal(body.capture.platform, "youtube");
    assert.equal(body.capture.status, "received");
    assert.equal(body.job.status, "queued");
    assert.equal(repository.captures.length, 1);
    assert.equal(repository.jobs.length, 1);
  } finally {
    await closeServer(server);
  }
});

test("capture API answers browser CORS preflight requests", async () => {
  const server = buildServer(new MemoryRepository());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/captures`, {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:8081",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type,x-user-id",
      },
    });

    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:8081");
    assert.match(response.headers.get("access-control-allow-headers") ?? "", /X-User-Id/);
  } finally {
    await closeServer(server);
  }
});

test("capture routes require an authenticated user context", async () => {
  const server = buildServer(new MemoryRepository(), { authenticate: async () => undefined });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/captures`, {
      headers: { "content-type": "application/json" },
    });

    assert.equal(response.status, 401);
    assert.match((await response.json() as { error: { message: string } }).error.message, /Authenticated user context/);
  } finally {
    await closeServer(server);
  }
});

test("capture intake rejects file references because the product is link-only", async () => {
  const server = buildServer(new MemoryRepository());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const response = await request(server, "/v1/captures", {
      method: "POST",
      body: JSON.stringify({ mediaFileName: "video.mp4" }),
    });

    assert.equal(response.status, 400);
    assert.match((await response.json() as { error: { message: string } }).error.message, /Only links are saved/);
  } finally {
    await closeServer(server);
  }
});

test("capture reads are isolated by authenticated user", async () => {
  const repository = new MemoryRepository();
  const server = buildServer(repository);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const createResponse = await request(server, "/v1/captures", {
      method: "POST",
      body: JSON.stringify({ url: "https://example.com/video" }),
    });
    const created = await createResponse.json() as { capture: CaptureRecord };
    const foreignResponse = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/v1/captures/${created.capture.id}`, {
      headers: { "x-user-id": "user-2" },
    });

    assert.equal(foreignResponse.status, 404);
    await foreignResponse.text();
  } finally {
    await closeServer(server);
  }
});

test("capture detail returns user-owned GitHub discovery results", async () => {
  const repository = new MemoryRepository();
  const server = buildServer(repository);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const createResponse = await request(server, "/v1/captures", {
      method: "POST",
      body: JSON.stringify({ url: "https://example.com/video" }),
    });
    const created = await createResponse.json() as { capture: CaptureRecord };
    await repository.saveGitHubRepositoryDiscovery({
      captureId: created.capture.id,
      userId: created.capture.userId,
      status: "found",
      selectionStatus: "unreviewed",
      candidates: [{
        fullName: "acme/demo-repo",
        owner: "acme",
        name: "demo-repo",
        url: "https://github.com/acme/demo-repo",
        confidence: 1,
        matchReasons: ["Direct GitHub URL found in source."],
        evidence: [{ kind: "direct_url", source: "transcript", value: "https://github.com/acme/demo-repo" }],
      }],
      queries: [],
      provider: "github-repository-search-v1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const detailResponse = await request(server, `/v1/captures/${created.capture.id}`);
    const detail = await detailResponse.json() as { githubRepositoryDiscovery?: { candidates: Array<{ fullName: string }> } };

    assert.equal(detailResponse.status, 200);
    assert.equal(detail.githubRepositoryDiscovery?.candidates[0]?.fullName, "acme/demo-repo");

    const selectionResponse = await request(server, `/v1/captures/${created.capture.id}/github-repositories/select`, {
      method: "POST",
      body: JSON.stringify({ decision: "accept", fullName: "acme/demo-repo" }),
    });
    const selection = await selectionResponse.json() as { githubRepositoryDiscovery: { selectionStatus: string; selectedFullName?: string } };

    assert.equal(selectionResponse.status, 200);
    assert.equal(selection.githubRepositoryDiscovery.selectionStatus, "accepted");
    assert.equal(selection.githubRepositoryDiscovery.selectedFullName, "acme/demo-repo");
  } finally {
    await closeServer(server);
  }
});

test("failed captures can be requeued without losing their source", async () => {
  const repository = new MemoryRepository();
  const server = buildServer(repository);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const createResponse = await request(server, "/v1/captures", {
      method: "POST",
      body: JSON.stringify({ url: "https://example.com/video" }),
    });
    const created = await createResponse.json() as { capture: CaptureRecord };
    const failedCapture = { ...created.capture, status: "failed" as const, currentStage: "failed" as const, errorMessage: "Source unavailable." };
    repository.captures[0] = failedCapture;

    const retryResponse = await request(server, `/v1/captures/${failedCapture.id}/retry`, { method: "POST" });
    const retried = await retryResponse.json() as { capture: CaptureRecord; job: ProcessingJob };

    assert.equal(retryResponse.status, 202);
    assert.equal(retried.capture.originalUrl, failedCapture.originalUrl);
    assert.equal(retried.capture.status, "received");
    assert.equal(retried.capture.retryCount, 1);
    assert.equal(retried.capture.errorMessage, undefined);
    assert.equal(retried.job.status, "queued");
  } finally {
    await closeServer(server);
  }
});

test("manual transcripts are persisted and resume downstream processing", async () => {
  const repository = new MemoryRepository();
  const server = buildServer(repository);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const createResponse = await request(server, "/v1/captures", {
      method: "POST",
      body: JSON.stringify({ url: "https://example.com/video" }),
    });
    const created = await createResponse.json() as { capture: CaptureRecord };
    repository.captures[0] = { ...created.capture, status: "needs_review", currentStage: "needs_review" };

    const transcriptResponse = await request(server, `/v1/captures/${created.capture.id}/transcript`, {
      method: "POST",
      body: JSON.stringify({ text: "Manually supplied transcript." }),
    });
    const body = await transcriptResponse.json() as { capture: CaptureRecord; job: ProcessingJob; transcript: TranscriptRecord };

    assert.equal(transcriptResponse.status, 202);
    assert.equal(body.transcript.source, "manual");
    assert.equal(body.transcript.text, "Manually supplied transcript.");
    assert.equal(body.capture.status, "discovering_repositories");
    assert.equal(body.job.stage, "discovering_repositories");
  } finally {
    await closeServer(server);
  }
});
