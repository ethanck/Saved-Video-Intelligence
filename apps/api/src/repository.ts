/** Persistence boundary for captures and their background processing jobs. */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  CaptureRecord,
  CaptureStage,
  GitHubRepositoryDiscoveryRecord,
  LocalStore,
  ProcessingJob,
  TranscriptRecord,
} from "@svi/shared-types";

export interface KnowledgeRepository {
  createCapture(capture: CaptureRecord): Promise<CaptureRecord>;
  getCapture(userId: string, captureId: string): Promise<CaptureRecord | undefined>;
  listCaptures(userId: string, query?: string): Promise<CaptureRecord[]>;
  updateCapture(capture: CaptureRecord): Promise<CaptureRecord>;
  createJob(job: ProcessingJob): Promise<ProcessingJob>;
  listJobs(userId: string, captureId?: string): Promise<ProcessingJob[]>;
  saveTranscript(transcript: TranscriptRecord): Promise<TranscriptRecord>;
  getTranscript(userId: string, captureId: string): Promise<TranscriptRecord | undefined>;
  saveGitHubRepositoryDiscovery(discovery: GitHubRepositoryDiscoveryRecord): Promise<GitHubRepositoryDiscoveryRecord>;
  getGitHubRepositoryDiscovery(userId: string, captureId: string): Promise<GitHubRepositoryDiscoveryRecord | undefined>;
  claimNextQueuedJob(stage: CaptureStage): Promise<ProcessingJob | undefined>;
  updateJob(job: ProcessingJob): Promise<ProcessingJob>;
}

/**
 * Small JSON-backed repository for local development and the first vertical slice.
 *
 * The interface keeps the API and worker independent from this storage choice so a
 * hosted database can replace it without changing route or worker behavior.
 */
export class JsonFileRepository implements KnowledgeRepository {
  private readonly filePath: string;
  private store: LocalStore = { captures: [], jobs: [], transcripts: [], githubRepositoryDiscoveries: [] };
  private loadPromise?: Promise<void>;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async createCapture(capture: CaptureRecord): Promise<CaptureRecord> {
    await this.ensureLoaded();
    this.store.captures.push(capture);
    await this.persist();
    return capture;
  }

  async getCapture(userId: string, captureId: string): Promise<CaptureRecord | undefined> {
    await this.ensureLoaded();
    return this.store.captures.find((capture) => capture.userId === userId && capture.id === captureId);
  }

  async listCaptures(userId: string, query?: string): Promise<CaptureRecord[]> {
    await this.ensureLoaded();
    const normalizedQuery = query?.trim().toLowerCase();
    return this.store.captures
      .filter((capture) => capture.userId === userId)
      .filter((capture) => {
        if (!normalizedQuery) return true;
        return [capture.originalUrl, capture.platform, capture.title, capture.caption]
          .filter(Boolean)
          .some((field) => field!.toLowerCase().includes(normalizedQuery));
      })
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async updateCapture(capture: CaptureRecord): Promise<CaptureRecord> {
    await this.ensureLoaded();
    const index = this.store.captures.findIndex((item) => item.id === capture.id && item.userId === capture.userId);
    if (index < 0) throw new Error("Capture not found.");
    this.store.captures[index] = capture;
    await this.persist();
    return capture;
  }

  async createJob(job: ProcessingJob): Promise<ProcessingJob> {
    await this.ensureLoaded();
    this.store.jobs.push(job);
    await this.persist();
    return job;
  }

  async listJobs(userId: string, captureId?: string): Promise<ProcessingJob[]> {
    await this.ensureLoaded();
    return this.store.jobs.filter((job) => job.userId === userId && (!captureId || job.captureId === captureId));
  }

  async claimNextQueuedJob(stage: CaptureStage): Promise<ProcessingJob | undefined> {
    await this.ensureLoaded();
    const job = this.store.jobs.find((item) => item.status === "queued" && item.stage === stage);
    if (!job) return undefined;
    const claimedJob = { ...job, status: "running" as const, updatedAt: new Date().toISOString() };
    await this.updateJob(claimedJob);
    return claimedJob;
  }

  async updateJob(job: ProcessingJob): Promise<ProcessingJob> {
    await this.ensureLoaded();
    const index = this.store.jobs.findIndex((item) => item.id === job.id && item.userId === job.userId);
    if (index < 0) throw new Error("Processing job not found.");
    this.store.jobs[index] = job;
    await this.persist();
    return job;
  }

  private async ensureLoaded(): Promise<void> {
    this.loadPromise ??= (async () => {
      try {
        const contents = await readFile(this.filePath, "utf8");
        const parsed = JSON.parse(contents) as Partial<LocalStore>;
        this.store = {
          captures: Array.isArray(parsed.captures) ? parsed.captures : [],
          jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
          transcripts: Array.isArray(parsed.transcripts) ? parsed.transcripts : [],
          githubRepositoryDiscoveries: Array.isArray(parsed.githubRepositoryDiscoveries) ? parsed.githubRepositoryDiscoveries : [],
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    })();
    await this.loadPromise;
  }

  async saveTranscript(transcript: TranscriptRecord): Promise<TranscriptRecord> {
    await this.ensureLoaded();
    this.store.transcripts = this.store.transcripts.filter(
      (item) => !(item.captureId === transcript.captureId && item.userId === transcript.userId),
    );
    this.store.transcripts.push(transcript);
    await this.persist();
    return transcript;
  }

  async getTranscript(userId: string, captureId: string): Promise<TranscriptRecord | undefined> {
    await this.ensureLoaded();
    return this.store.transcripts.find((item) => item.userId === userId && item.captureId === captureId);
  }

  async saveGitHubRepositoryDiscovery(discovery: GitHubRepositoryDiscoveryRecord): Promise<GitHubRepositoryDiscoveryRecord> {
    await this.ensureLoaded();
    this.store.githubRepositoryDiscoveries = this.store.githubRepositoryDiscoveries.filter(
      (item) => !(item.captureId === discovery.captureId && item.userId === discovery.userId),
    );
    this.store.githubRepositoryDiscoveries.push(discovery);
    await this.persist();
    return discovery;
  }

  async getGitHubRepositoryDiscovery(userId: string, captureId: string): Promise<GitHubRepositoryDiscoveryRecord | undefined> {
    await this.ensureLoaded();
    const discovery = this.store.githubRepositoryDiscoveries.find((item) => item.userId === userId && item.captureId === captureId);
    return discovery ? { ...discovery, selectionStatus: discovery.selectionStatus ?? "unreviewed" } : undefined;
  }

  private async persist(): Promise<void> {
    // Serialize writes and rename a complete temporary file to avoid partial JSON.
    this.writeChain = this.writeChain.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(this.store, null, 2)}\n`, "utf8");
      await rename(temporaryPath, this.filePath);
    });
    return this.writeChain;
  }
}
