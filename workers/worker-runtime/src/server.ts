/** HTTP entry point for a deployable Cloud Run worker service. */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { FirestoreRepository } from "../../../apps/api/src/firestore-repository.js";
import { JsonFileRepository, type KnowledgeRepository } from "../../../apps/api/src/repository.js";
import { PublicMetadataExtractor } from "../../../packages/ingestion/src/index.js";
import { PipelineWorker } from "../../../workers/pipeline-worker/src/index.js";
import { MetadataWorker } from "../../../workers/metadata-worker/src/index.js";
import {
  createGitHubRepositorySearcherFromEnvironment,
  GitHubRepositoryDiscoveryStageHandler,
} from "../../../workers/repository-discovery-worker/src/index.js";
import {
  createUnconfiguredTranscriptProviders,
  TranscriptionStageHandler,
} from "../../../workers/transcription-worker/src/index.js";
import { processingStages, type ProcessingStageHandler } from "../../../packages/processing/src/index.js";
import type { CaptureStage } from "@svi/shared-types";

const host = process.env.WORKER_HOST ?? "0.0.0.0";
const port = Number(process.env.WORKER_PORT ?? process.env.PORT ?? "8080");
const configuredStage = (process.env.WORKER_STAGE ?? "transcribing") as CaptureStage;
const workerAuthToken = process.env.WORKER_AUTH_TOKEN;
const dataFile = process.env.DATA_FILE ?? "./data/local-store.json";

function createRepository(): KnowledgeRepository {
  return process.env.FIRESTORE_ENABLED === "true"
    ? new FirestoreRepository()
    : new JsonFileRepository(dataFile);
}

function createRunOnce(repository: KnowledgeRepository): () => Promise<unknown> {
  if (configuredStage === "received") {
    const worker = new MetadataWorker(repository, new PublicMetadataExtractor({
      timeoutMs: Number(process.env.METADATA_FETCH_TIMEOUT_MS ?? "10000"),
      maxBytes: Number(process.env.METADATA_MAX_BYTES ?? "262144"),
    }));
    return () => worker.runOnce();
  }

  if (configuredStage === "transcribing") {
    const handler = new TranscriptionStageHandler(repository, createUnconfiguredTranscriptProviders());
    const worker = new PipelineWorker(repository, configuredStage, handler);
    return () => worker.runOnce();
  }

  if (configuredStage === "discovering_repositories") {
    const handler = new GitHubRepositoryDiscoveryStageHandler(
      repository,
      createGitHubRepositorySearcherFromEnvironment(),
    );
    const worker = new PipelineWorker(repository, configuredStage, handler);
    return () => worker.runOnce();
  }

  if (processingStages.includes(configuredStage as (typeof processingStages)[number])) {
    const handler: ProcessingStageHandler = {
      process: async () => ({
        kind: "needs_review" as const,
        reason: `${configuredStage} provider is not configured yet.`,
      }),
    };
    const worker = new PipelineWorker(repository, configuredStage as (typeof processingStages)[number], handler);
    return () => worker.runOnce();
  }

  throw new Error(`No worker handler is configured for stage: ${configuredStage}`);
}

function isAuthorized(request: IncomingMessage): boolean {
  // In production, Cloud Run IAM authenticates the caller before this process
  // receives the request. A shared token remains available for local/testing
  // deployments that do not have IAM in front of them.
  if (!workerAuthToken) return process.env.NODE_ENV !== "production" || process.env.WORKER_TRUST_CLOUD_RUN_IAM === "true";
  const authorization = request.headers.authorization;
  return authorization === `Bearer ${workerAuthToken}`;
}

function writeJson(response: ServerResponse, statusCode: number, value: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

const repository = createRepository();
const runOnce = createRunOnce(repository);
const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (requestUrl.pathname === "/health" && request.method === "GET") {
    return writeJson(response, 200, { status: "ok", stage: configuredStage });
  }

  if (requestUrl.pathname !== "/tasks/process" || request.method !== "POST") {
    return writeJson(response, 404, { error: { message: "Route not found." } });
  }

  if (!isAuthorized(request)) {
    return writeJson(response, 401, { error: { message: "Worker authentication required." } });
  }

  try {
    const result = await runOnce();
    return writeJson(response, 200, result);
  } catch (error) {
    console.error("Worker execution failed", error);
    return writeJson(response, 500, { error: { message: "Worker execution failed." } });
  }
});

if (process.argv[1]?.endsWith("server.ts") || process.argv[1]?.endsWith("server.js")) {
  server.listen(port, host, () => {
    console.log(`Saved Video Intelligence ${configuredStage} worker listening on http://${host}:${port}`);
  });
}
