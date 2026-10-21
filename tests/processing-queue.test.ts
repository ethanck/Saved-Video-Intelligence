import assert from "node:assert/strict";
import test from "node:test";
import { CloudTasksProcessingQueue } from "../packages/processing/src/queue.js";
import type { ProcessingJob } from "@svi/shared-types";
import type { CloudTasksClient } from "@google-cloud/tasks";

test("Cloud Tasks routes each stage to its configured worker URL", async () => {
  let taskUrl = "";
  const client = {
    queuePath: () => "projects/test/locations/us-east1/queues/svi-processing",
    createTask: async ({ task }: { task: { httpRequest?: { url?: string } } }) => {
      taskUrl = task.httpRequest?.url ?? "";
      return [{}];
    },
  } as unknown as CloudTasksClient;
  const queue = new CloudTasksProcessingQueue({
    projectId: "test",
    location: "us-east1",
    queueName: "svi-processing",
    workerUrls: {
      transcribing: "https://transcribing.example/tasks/process",
      discovering_repositories: "https://discovery.example/tasks/process",
    },
    serviceAccountEmail: "tasks@test.iam.gserviceaccount.com",
  }, client);
  const job = {
    id: "job-1",
    captureId: "capture-1",
    userId: "user-1",
    status: "queued",
    stage: "discovering_repositories",
    retryCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } satisfies ProcessingJob;

  await queue.enqueue(job);

  assert.equal(taskUrl, "https://discovery.example/tasks/process");
});
