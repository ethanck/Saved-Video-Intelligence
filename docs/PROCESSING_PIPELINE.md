# Processing pipeline

## Deployment boundary

The device contains only the Expo/React Native client, authentication session,
API client, and processing-status UI. It does not contain worker code, provider
credentials, queue configuration, or a list of providers to invoke.

Firebase is the control plane:

- Firebase Authentication identifies the user.
- Firestore stores captures, processing jobs, durable status, failures, review
  reasons, and derived knowledge.
- Firestore security rules protect user-owned documents.

The execution plane is Google Cloud behind Firebase:

- Cloud Tasks or Pub/Sub dispatches one stage job at a time.
- Cloud Run services are the preferred runtime for media, transcription, OCR,
  summarization, and embedding workloads because they can run longer and use
  more memory than a request handler.
- Cloud Functions may be used for lightweight Firestore triggers and queue
  dispatch, but should not perform heavy media processing themselves.
- Secret Manager stores provider credentials. Secrets are injected only into
  worker services.

This keeps the app independent from provider choices and prevents an API key or
worker implementation from shipping in the iOS/web bundle.

## Durable job flow

```text
capture API
  → Firestore capture + queued job
  → queue dispatcher selects the worker URL for the job stage
  → one stage worker
  → Firestore result + next queued stage
  → ...
  → ready or needs_review
```

The current code implements the first metadata worker and the generic
`PipelineWorker` contract. The generic worker claims one stage, invokes an
injected backend provider, preserves the original source URL, and either queues
the next stage, routes to `needs_review`, or records a failure. It cannot mark a
capture `ready` except when the final embedding stage explicitly succeeds.

When a worker advances a capture, it persists the next queued job and then
hands that job to the configured `ProcessingQueue`. Local development uses a
no-op queue because polling workers claim queued jobs directly. Production
Cloud Run services use Cloud Tasks so the next stage receives its own task. If
managed dispatch is temporarily unavailable, the durable queued job is kept in
Firestore and logged for reconciliation rather than being falsely marked as a
processing failure.

`workers/worker-runtime/src/server.ts` is the deployable HTTP entry point. It
supports the initial metadata stage and every processing-stage name, with one
Cloud Run service per configured `WORKER_STAGE`. The transcription and GitHub
repository discovery stages have dedicated handlers today; other unconfigured
stages safely route to review instead of fabricating output. `/health` is public
for service health checks; `/tasks/process` is protected and intended for Cloud
Tasks or Pub/Sub delivery.

Full stage order when future providers are enabled:

```text
received
→ fetching_metadata
→ extracting_media
→ transcribing
→ discovering_repositories
→ extracting_frames
→ ocr
→ summarizing
→ classifying
→ embedding
→ ready
```

The MVP intentionally uses a shorter active path:

```text
received → transcribing (only when a public caption track exists)
         → discovering_repositories → needs_review
```

Sources without public captions go directly from metadata to `needs_review` so
the user can paste a manual transcript. The media, frame, OCR, summary,
classification, and embedding stages remain available extension points but do
not block the MVP.

## Transcript fallback order

The transcription worker uses `TranscriptFallbackChain`. The intended provider
order is:

1. A bounded public WebVTT/text caption track discovered from the source page,
   when permitted and actually available.
2. Manual transcript entry and review when public captions are unavailable.

Google Cloud Speech-to-Text is intentionally not part of the MVP deployment.
It can be added later as another `TranscriptProvider` without changing the API,
stored transcript schema, or manual fallback: the new provider would consume a
permitted temporary audio artifact and be inserted after public captions.

Every attempt is persisted with its method, provider, timestamps, success or
failure, and error message. The system never treats a social caption as a
transcript, never bypasses authentication or DRM, and never marks a failed
source ready.

The API exposes `POST /v1/captures/:id/transcript` for the manual fallback. It
stores the user-provided transcript in the separate `transcripts` collection
and resumes the pipeline at `discovering_repositories`.

## GitHub repository discovery

`packages/processing/src/github-repository-discovery.ts` owns the provider-
neutral discovery logic. It extracts direct GitHub URLs and explicit
`owner/name` references from the original URL, metadata, captions, and
transcript. It then creates short, bounded contextual queries and ranks the
GitHub API results against repository name, description, and capture title.

The worker persists a `githubRepositoryDiscoveries/{captureId}` record with
candidate repositories, confidence scores, source evidence, bounded queries,
provider errors, and `found`, `needs_review`, or `not_found` status. Direct
links are high-confidence and remain useful when remote search is disabled.
Contextual matches are suggestions only and are shown for review; the system
does not silently claim that a repository is the one discussed in a video.
`GITHUB_DISCOVERY_ENABLED` is opt-in, and `GITHUB_TOKEN` is backend-only.

The authenticated endpoint
`POST /v1/captures/:id/github-repositories/select` records an explicit
`accept` or `reject` decision. Acceptance is allowed only for a candidate that
was actually produced for that capture, and the selection is stored with a
review timestamp.

Provider implementations remain behind interfaces. The MVP public-caption
adapter only reads bounded public caption tracks and never downloads video.
A missing, denied, or low-confidence provider result must fail safely or route
to review; it must not fabricate a transcript, summary, classification, or
recipe.

## Local development

Local development may run the API and stage workers as separate Node processes
against the JSON repository. Firestore emulator support can be added for local
integration tests. The local runner is a development convenience only; the
production deployment should use Firestore plus managed queue/worker services.

## Still required for production

- Provider implementations for permitted metadata/media access, transcription,
  OCR, summarization, classification, and embeddings.
- User confirmation flow for accepting or rejecting repository candidates.
- Cloud Run deployment, stage-specific worker URLs, and enabling managed queue
  dispatch for future media/OCR/knowledge stages. The MVP stages are deployed
  and dispatch through Cloud Tasks.
- Reconciliation for jobs that remain queued after a dispatch outage.
- Stage-specific Cloud Run worker URLs for future media/OCR/knowledge stages.
- Idempotency keys, lease expiry, exponential backoff, dead-letter handling,
  rate limits, and per-provider quotas.
- A knowledge-item data model for transcripts, summaries, recipes, tags, and
  embeddings.
- Operational logging, metrics, tracing, and alerting.
- Review of Firestore rules and deployment configuration before production use.
