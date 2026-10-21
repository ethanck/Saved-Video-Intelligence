import type {
  CaptureInput,
  CaptureRecord,
  GitHubRepositoryDiscoveryRecord,
  ProcessingJob,
  TranscriptRecord,
} from "@svi/shared-types";

export type ApiClientOptions = {
  baseUrl: string;
  /** Development-only identity used by the local JSON API. */
  userId?: string;
  /** Resolve a current Firebase ID token for production API requests. */
  getIdToken?: () => Promise<string | undefined>;
  fetchImpl?: typeof fetch;
};

/** Error returned when the API responds with a non-success status. */
export class ApiClientError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
  }
}

/** Response returned when a capture is queued or retried. */
export type CaptureResponse = { capture: CaptureRecord; job: ProcessingJob };

/** Response returned for a capture detail request. */
export type CaptureDetailResponse = {
  capture: CaptureRecord;
  jobs: ProcessingJob[];
  transcript?: TranscriptRecord;
  githubRepositoryDiscovery?: GitHubRepositoryDiscoveryRecord;
};

export type GitHubRepositorySelectionResponse = {
  capture: CaptureRecord;
  githubRepositoryDiscovery: GitHubRepositoryDiscoveryRecord;
};

/** Small platform-neutral client used by both the Expo app and future web entry points. */
export class ApiClient {
  private readonly baseUrl: string;
  private readonly userId: string | undefined;
  private readonly getIdToken: (() => Promise<string | undefined>) | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.userId = options.userId;
    this.getIdToken = options.getIdToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** Load the authenticated user's Inbox, optionally filtered by text. */
  async listCaptures(query?: string): Promise<CaptureRecord[]> {
    const params = query ? `?q=${encodeURIComponent(query)}` : "";
    const response = await this.request<{ captures: CaptureRecord[] }>(`/v1/captures${params}`);
    return response.captures;
  }

  /** Load one capture and its processing history. */
  async getCapture(id: string): Promise<CaptureDetailResponse> {
    return this.request<CaptureDetailResponse>(`/v1/captures/${encodeURIComponent(id)}`);
  }

  /** Submit a public URL or shared text containing a URL for processing. */
  async createCapture(input: CaptureInput): Promise<CaptureResponse> {
    return this.request<CaptureResponse>("/v1/captures", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  /** Requeue a failed or review-needed capture. */
  async retryCapture(id: string): Promise<CaptureResponse> {
    return this.request<CaptureResponse>(`/v1/captures/${encodeURIComponent(id)}/retry`, {
      method: "POST",
    });
  }

  /** Supply a transcript manually and resume downstream processing. */
  async submitManualTranscript(id: string, text: string): Promise<CaptureResponse & { transcript: TranscriptRecord }> {
    return this.request<CaptureResponse & { transcript: TranscriptRecord }>(`/v1/captures/${encodeURIComponent(id)}/transcript`, {
      method: "POST",
      body: JSON.stringify({ text }),
    });
  }

  /** Accept one suggested repository or reject the current suggestions. */
  async selectGitHubRepository(
    id: string,
    decision: "accept" | "reject",
    fullName?: string,
  ): Promise<GitHubRepositorySelectionResponse> {
    return this.request<GitHubRepositorySelectionResponse>(`/v1/captures/${encodeURIComponent(id)}/github-repositories/select`, {
      method: "POST",
      body: JSON.stringify({ decision, ...(fullName ? { fullName } : {}) }),
    });
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const idToken = await this.getIdToken?.();
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    headers.set("content-type", "application/json");
    if (this.userId) headers.set("x-user-id", this.userId);
    if (idToken) headers.set("authorization", `Bearer ${idToken}`);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers,
      });
    } catch (error) {
      const reason = error instanceof Error && error.message ? ` ${error.message}` : "";
      throw new ApiClientError(0, `Could not reach the API at ${this.baseUrl}.${reason}`);
    }

    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const message = isErrorBody(body) && body.error.message
        ? body.error.message
        : `Request failed with status ${response.status}.`;
      throw new ApiClientError(response.status, message);
    }
    return body as T;
  }
}

function isErrorBody(value: unknown): value is { error: { message?: string } } {
  if (!value || typeof value !== "object" || !("error" in value)) return false;
  const error = (value as { error?: unknown }).error;
  return Boolean(error && typeof error === "object" && "message" in error);
}
