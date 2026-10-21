/** Managed queue boundary for dispatching durable processing jobs. */
import { CloudTasksClient, protos } from "@google-cloud/tasks";
import type { CaptureStage, ProcessingJob } from "@svi/shared-types";
import { processingStages } from "./index.js";

export interface ProcessingQueue {
  enqueue(job: ProcessingJob): Promise<void>;
}

/** Local mode keeps the existing polling workers in charge of queued jobs. */
export class NoopProcessingQueue implements ProcessingQueue {
  async enqueue(): Promise<void> {
    // The local metadata runner and tests claim queued jobs directly.
  }
}

export type CloudTasksQueueOptions = {
  projectId: string;
  location: string;
  queueName: string;
  workerUrl?: string;
  workerUrls?: Partial<Record<CaptureStage, string>>;
  serviceAccountEmail: string;
};

/** Cloud Tasks dispatcher for authenticated Cloud Run worker services. */
export class CloudTasksProcessingQueue implements ProcessingQueue {
  constructor(
    private readonly options: CloudTasksQueueOptions,
    private readonly client: CloudTasksClient = new CloudTasksClient(),
  ) {}

  async enqueue(job: ProcessingJob): Promise<void> {
    const workerUrl = this.options.workerUrls?.[job.stage] ?? this.options.workerUrl;
    if (!workerUrl) throw new Error(`No Cloud Run worker URL is configured for stage ${job.stage}.`);
    const parent = this.client.queuePath(this.options.projectId, this.options.location, this.options.queueName);
    const task: protos.google.cloud.tasks.v2.ITask = {
      httpRequest: {
        httpMethod: "POST",
        url: workerUrl,
        headers: { "content-type": "application/json" },
        body: Buffer.from(JSON.stringify({ jobId: job.id, captureId: job.captureId, stage: job.stage })).toString("base64"),
        oidcToken: {
          serviceAccountEmail: this.options.serviceAccountEmail,
          audience: workerUrl,
        },
      },
    };
    await this.client.createTask({ parent, task });
  }
}

/** Select local polling or Cloud Tasks from environment configuration. */
export function createProcessingQueueFromEnvironment(): ProcessingQueue {
  if (process.env.CLOUD_TASKS_ENABLED !== "true") return new NoopProcessingQueue();

  const required = {
    projectId: process.env.CLOUD_TASKS_PROJECT_ID,
    location: process.env.CLOUD_TASKS_LOCATION,
    queueName: process.env.CLOUD_TASKS_QUEUE,
    serviceAccountEmail: process.env.CLOUD_TASKS_SERVICE_ACCOUNT_EMAIL,
  };
  const missing = Object.entries(required).filter(([, value]) => !value).map(([key]) => key);
  if (missing.length > 0) throw new Error(`Cloud Tasks is enabled but missing configuration: ${missing.join(", ")}.`);

  const workerUrls: Partial<Record<CaptureStage, string>> = {};
  const stages: CaptureStage[] = ["received", ...processingStages];
  for (const stage of stages) {
    const environmentKey = `CLOUD_TASKS_WORKER_URL_${stage.toUpperCase()}`;
    const url = process.env[environmentKey];
    if (url) workerUrls[stage] = url;
  }
  const defaultWorkerUrl = process.env.CLOUD_TASKS_WORKER_URL;
  if (!defaultWorkerUrl && Object.keys(workerUrls).length === 0) {
    throw new Error("Cloud Tasks is enabled but no worker URL is configured.");
  }

  return new CloudTasksProcessingQueue({
    projectId: required.projectId!,
    location: required.location!,
    queueName: required.queueName!,
    serviceAccountEmail: required.serviceAccountEmail!,
    ...(defaultWorkerUrl ? { workerUrl: defaultWorkerUrl } : {}),
    ...(Object.keys(workerUrls).length > 0 ? { workerUrls } : {}),
  });
}
