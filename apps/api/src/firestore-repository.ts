/** Firestore-backed repository used when the production storage flag is enabled. */
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import type {
  CaptureRecord,
  CaptureStage,
  GitHubRepositoryDiscoveryRecord,
  LocalStore,
  ProcessingJob,
  TranscriptRecord,
} from "@svi/shared-types";
import { getFirebaseApp } from "./firebase.js";
import type { KnowledgeRepository } from "./repository.js";

const captureCollection = "captures";
const jobCollection = "jobs";
const transcriptCollection = "transcripts";
const githubRepositoryDiscoveryCollection = "githubRepositoryDiscoveries";

/**
 * Firestore implementation of the same contract as the local JSON repository.
 * The API and workers can switch storage without changing their domain behavior.
 */
export class FirestoreRepository implements KnowledgeRepository {
  constructor(private readonly db: Firestore = getFirestore(getFirebaseApp())) {}

  async createCapture(capture: CaptureRecord): Promise<CaptureRecord> {
    await this.db.collection(captureCollection).doc(capture.id).create(stripUndefined(capture));
    return capture;
  }

  async getCapture(userId: string, captureId: string): Promise<CaptureRecord | undefined> {
    const snapshot = await this.db.collection(captureCollection).doc(captureId).get();
    if (!snapshot.exists) return undefined;
    const capture = snapshot.data() as CaptureRecord;
    return capture.userId === userId ? capture : undefined;
  }

  async listCaptures(userId: string, query?: string): Promise<CaptureRecord[]> {
    const snapshot = await this.db.collection(captureCollection)
      .where("userId", "==", userId)
      .orderBy("createdAt", "desc")
      .limit(100)
      .get();
    const normalizedQuery = query?.trim().toLowerCase();
    return snapshot.docs
      .map((document) => document.data() as CaptureRecord)
      .filter((capture) => !normalizedQuery || [capture.originalUrl, capture.platform, capture.title, capture.caption]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(normalizedQuery)));
  }

  async updateCapture(capture: CaptureRecord): Promise<CaptureRecord> {
    const reference = this.db.collection(captureCollection).doc(capture.id);
    const current = await reference.get();
    if (!current.exists || (current.data() as CaptureRecord).userId !== capture.userId) throw new Error("Capture not found.");
    await reference.set(stripUndefined(capture));
    return capture;
  }

  async createJob(job: ProcessingJob): Promise<ProcessingJob> {
    await this.db.collection(jobCollection).doc(job.id).create(stripUndefined(job));
    return job;
  }

  async listJobs(userId: string, captureId?: string): Promise<ProcessingJob[]> {
    let query = this.db.collection(jobCollection).where("userId", "==", userId);
    if (captureId) query = query.where("captureId", "==", captureId);
    query = query.orderBy("createdAt", "desc").limit(100);
    const snapshot = await query.get();
    return snapshot.docs.map((document) => document.data() as ProcessingJob);
  }

  async saveTranscript(transcript: TranscriptRecord): Promise<TranscriptRecord> {
    await this.db.collection(transcriptCollection).doc(transcript.captureId).set(stripUndefined(transcript));
    return transcript;
  }

  async getTranscript(userId: string, captureId: string): Promise<TranscriptRecord | undefined> {
    const snapshot = await this.db.collection(transcriptCollection).doc(captureId).get();
    if (!snapshot.exists) return undefined;
    const transcript = snapshot.data() as TranscriptRecord;
    return transcript.userId === userId ? transcript : undefined;
  }

  async saveGitHubRepositoryDiscovery(discovery: GitHubRepositoryDiscoveryRecord): Promise<GitHubRepositoryDiscoveryRecord> {
    await this.db.collection(githubRepositoryDiscoveryCollection).doc(discovery.captureId).set(stripUndefined(discovery));
    return discovery;
  }

  async getGitHubRepositoryDiscovery(userId: string, captureId: string): Promise<GitHubRepositoryDiscoveryRecord | undefined> {
    const snapshot = await this.db.collection(githubRepositoryDiscoveryCollection).doc(captureId).get();
    if (!snapshot.exists) return undefined;
    const discovery = snapshot.data() as GitHubRepositoryDiscoveryRecord;
    return discovery.userId === userId
      ? { ...discovery, selectionStatus: discovery.selectionStatus ?? "unreviewed" }
      : undefined;
  }

  async claimNextQueuedJob(stage: CaptureStage): Promise<ProcessingJob | undefined> {
    const query = this.db.collection(jobCollection)
      .where("status", "==", "queued")
      .where("stage", "==", stage)
      .orderBy("createdAt", "asc")
      .limit(1);
    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(query);
      const document = snapshot.docs[0];
      if (!document) return undefined;
      const job = document.data() as ProcessingJob;
      const claimedJob: ProcessingJob = { ...job, status: "running", updatedAt: new Date().toISOString() };
      transaction.update(document.ref, stripUndefined(claimedJob));
      return claimedJob;
    });
  }

  async updateJob(job: ProcessingJob): Promise<ProcessingJob> {
    const reference = this.db.collection(jobCollection).doc(job.id);
    const current = await reference.get();
    if (!current.exists || (current.data() as ProcessingJob).userId !== job.userId) throw new Error("Processing job not found.");
    await reference.set(stripUndefined(job));
    return job;
  }
}

/** Keep the adapter's local-store shape visible to future migration scripts. */
export type FirestoreMigrationSource = LocalStore;

/** Remove optional undefined fields because Firestore rejects them by default. */
function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripUndefined) as T;
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return value;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .map(([key, entry]) => [key, stripUndefined(entry)] as const);
  return Object.fromEntries(entries) as T;
}
