/** HTTP API for capture intake, Inbox reads, and retry requests. */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { AuthenticationError, FirebaseAuthenticator, type Authenticator } from "./auth.js";
import { createCapture, createProcessingJob } from "./domain.js";
import { FirestoreRepository } from "./firestore-repository.js";
import { JsonFileRepository, type KnowledgeRepository } from "./repository.js";
import {
  parseCaptureInput,
  parseGitHubRepositorySelectionInput,
  parseManualTranscriptInput,
  ValidationError,
} from "./validation.js";
import type { ProcessingJob, TranscriptRecord } from "@svi/shared-types";
import { createProcessingQueueFromEnvironment, type ProcessingQueue } from "../../../packages/processing/src/queue.js";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? "8787");
const dataFile = process.env.DATA_FILE ?? "./data/local-store.json";
const maxBodyBytes = Number(process.env.MAX_CAPTURE_BODY_BYTES ?? "1048576");
const allowedCorsOrigins = new Set(
  (process.env.CORS_ORIGINS ?? "http://localhost:8081,http://127.0.0.1:8081")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

/** Build an injectable Node HTTP server for production and integration tests. */
function createDefaultRepository(): KnowledgeRepository {
  return process.env.FIRESTORE_ENABLED === "true"
    ? new FirestoreRepository()
    : new JsonFileRepository(dataFile);
}

/** Build an injectable Node HTTP server for production and integration tests. */
export function buildServer(
  repository: KnowledgeRepository = createDefaultRepository(),
  authenticator: Authenticator = new FirebaseAuthenticator(),
  queue: ProcessingQueue = createProcessingQueueFromEnvironment(),
) {
  return createServer(async (request, response) => {
    try {
      await routeRequest(request, response, repository, authenticator, queue);
    } catch (error) {
      if (error instanceof AuthenticationError) {
        return writeError(response, 401, error.message);
      }
      if (error instanceof ValidationError) {
        return writeError(response, 400, error.message);
      }
      writeError(response, 500, "Internal server error.");
      console.error(error);
    }
  });
}

async function routeRequest(request: IncomingMessage, response: ServerResponse, repository: KnowledgeRepository, authenticator: Authenticator, queue: ProcessingQueue): Promise<void> {
  const method = request.method ?? "GET";
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  applyCorsHeaders(request, response);
  if (method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  const userId = await authenticator.authenticate(request);

  if (requestUrl.pathname === "/health" && method === "GET") {
    return writeJson(response, 200, { status: "ok" });
  }

  if (typeof userId !== "string" || !userId.trim()) {
    return writeError(response, 401, "Authenticated user context is required.");
  }

  if (requestUrl.pathname === "/v1/captures" && method === "POST") {
    const input = parseCaptureInput(await readJson(request));
    const capture = createCapture(userId, input);
    const job = createProcessingJob(capture);
    await repository.createCapture(capture);
    await repository.createJob(job);
    await enqueueWithoutBlocking(queue, job);
    return writeJson(response, 202, { capture, job });
  }

  if (requestUrl.pathname === "/v1/captures" && method === "GET") {
    const captures = await repository.listCaptures(userId, requestUrl.searchParams.get("q") ?? undefined);
    return writeJson(response, 200, { captures });
  }

  const repositorySelectionMatch = requestUrl.pathname.match(/^\/v1\/captures\/([^/]+)\/github-repositories\/select$/);
  if (repositorySelectionMatch && method === "POST") {
    const captureId = decodeURIComponent(repositorySelectionMatch[1]!);
    const capture = await repository.getCapture(userId, captureId);
    if (!capture) return writeError(response, 404, "Capture not found.");
    const discovery = await repository.getGitHubRepositoryDiscovery(userId, captureId);
    if (!discovery) return writeError(response, 404, "GitHub repository discovery is not available yet.");

    const input = parseGitHubRepositorySelectionInput(await readJson(request));
    const now = new Date().toISOString();
    if (input.decision === "accept") {
      const candidate = discovery.candidates.find((item) => item.fullName.toLowerCase() === input.fullName!.toLowerCase());
      if (!candidate) return writeError(response, 400, "That repository is not one of the suggested candidates.");
      const updatedDiscovery = {
        ...discovery,
        selectionStatus: "accepted" as const,
        selectedFullName: candidate.fullName,
        reviewedAt: now,
        updatedAt: now,
      };
      await repository.saveGitHubRepositoryDiscovery(updatedDiscovery);
      return writeJson(response, 200, { capture, githubRepositoryDiscovery: updatedDiscovery });
    }

    const { selectedFullName: _selectedFullName, ...withoutSelection } = discovery;
    const updatedDiscovery = {
      ...withoutSelection,
      selectionStatus: "rejected" as const,
      reviewedAt: now,
      updatedAt: now,
    };
    await repository.saveGitHubRepositoryDiscovery(updatedDiscovery);
    return writeJson(response, 200, { capture, githubRepositoryDiscovery: updatedDiscovery });
  }

  const captureMatch = requestUrl.pathname.match(/^\/v1\/captures\/([^/]+)(\/(retry|transcript))?$/);
  if (captureMatch) {
    const captureId = decodeURIComponent(captureMatch[1]!);
    const action = captureMatch[3];
    const isRetry = action === "retry";
    const capture = await repository.getCapture(userId, captureId);
    if (!capture) return writeError(response, 404, "Capture not found.");

    if (method === "POST" && action === "transcript") {
      const input = parseManualTranscriptInput(await readJson(request));
      const now = new Date().toISOString();
      const existingTranscript = await repository.getTranscript(userId, captureId);
      const transcript: TranscriptRecord = {
        captureId,
        userId,
        text: input.text,
        segments: [],
        source: "manual",
        provider: "manual",
        attempts: [],
        createdAt: existingTranscript?.createdAt ?? now,
        updatedAt: now,
      };
      const { errorMessage: _errorMessage, completedAt: _completedAt, reviewReason: _reviewReason, ...captureWithoutTerminalState } = capture;
      const resumedCapture = {
        ...captureWithoutTerminalState,
        status: "discovering_repositories" as const,
        currentStage: "discovering_repositories" as const,
        transcriptSource: "manual" as const,
        updatedAt: now,
      };
      const job = createProcessingJob(resumedCapture);
      await repository.saveTranscript(transcript);
      await repository.updateCapture(resumedCapture);
      await repository.createJob(job);
      await enqueueWithoutBlocking(queue, job);
      return writeJson(response, 202, { capture: resumedCapture, job, transcript });
    }

    if (method === "GET" && !isRetry) {
      const jobs = await repository.listJobs(userId, captureId);
      const transcript = await repository.getTranscript(userId, captureId);
      const githubRepositoryDiscovery = await repository.getGitHubRepositoryDiscovery(userId, captureId);
      return writeJson(response, 200, {
        capture,
        jobs,
        ...(transcript ? { transcript } : {}),
        ...(githubRepositoryDiscovery ? { githubRepositoryDiscovery } : {}),
      });
    }

    if (method === "POST" && isRetry) {
      const now = new Date().toISOString();
      const { errorMessage: _errorMessage, completedAt: _completedAt, ...captureWithoutTerminalState } = capture;
      const retryCapture = {
        ...captureWithoutTerminalState,
        status: "received" as const,
        currentStage: "received" as const,
        retryCount: capture.retryCount + 1,
        updatedAt: now,
      };
      const job = createProcessingJob(retryCapture);
      await repository.updateCapture(retryCapture);
      await repository.createJob(job);
      await enqueueWithoutBlocking(queue, job);
      return writeJson(response, 202, { capture: retryCapture, job });
    }
  }

  return writeError(response, 404, "Route not found.");
}

/** Keep the durable queued job available if a managed queue is temporarily unavailable. */
async function enqueueWithoutBlocking(queue: ProcessingQueue, job: ProcessingJob): Promise<void> {
  try {
    await queue.enqueue(job);
  } catch (error) {
    console.error(`Could not dispatch processing job ${job.id}; it remains queued for reconciliation.`, error);
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > maxBodyBytes) throw new ValidationError("Request body is too large.");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ValidationError("Request body must be valid JSON.");
  }
}

function writeJson(response: ServerResponse, statusCode: number, value: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function applyCorsHeaders(request: IncomingMessage, response: ServerResponse): void {
  const origin = request.headers.origin;
  if (typeof origin !== "string" || !allowedCorsOrigins.has(origin)) return;

  response.setHeader("access-control-allow-origin", origin);
  response.setHeader("vary", "Origin");
  response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  response.setHeader("access-control-allow-headers", "Accept, Authorization, Content-Type, X-User-Id");
}

function writeError(response: ServerResponse, statusCode: number, message: string): void {
  writeJson(response, statusCode, { error: { message } });
}

const server = buildServer();
if (process.argv[1]?.endsWith("server.ts") || process.argv[1]?.endsWith("server.js")) {
  server.listen(port, host, () => {
    console.log(`Saved Video Intelligence API listening on http://${host}:${port}`);
  });
}
