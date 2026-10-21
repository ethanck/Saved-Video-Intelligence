# Codebase architecture

This document is a short orientation guide for agents working in the repository. The product-level decisions and acceptance criteria remain in [`IMPLEMENTATION_GUIDE.md`](../IMPLEMENTATION_GUIDE.md); durable agent rules are in [`AGENTS.md`](../AGENTS.md).

## Product boundary

Saved Video Intelligence is a Knowledge Library, not Note Chat. It owns source capture, provenance, asynchronous processing, browsing, search, recipes, skill review, and read-only MCP access. A future Note Chat integration may deep-link to a source, but the Knowledge Library must not grow a discussion workflow of its own.

## Runtime flow

```text
Share Extension or Expo client
        ↓ POST /v1/captures
Capture record + queued processing job
        ↓ future worker orchestration
Metadata → captions/media → transcript → GitHub repository discovery → OCR → summary → JEV classification → indexing
        ↓
Library item, category routing, review state, MCP read/search
```

The API currently stops after persisting the capture and queued job. The metadata worker can claim the `received` stage, safely fetch a bounded public HTML response, store lightweight metadata, and advance a job to `extracting_media`. No request handler or default worker should download media or call an AI provider. If temporary media processing is added later, the temporary bytes must be discarded after processing.

The processing boundary is documented in [`PROCESSING_PIPELINE.md`](./PROCESSING_PIPELINE.md). Firebase/Firestore is the durable control plane; managed Google Cloud worker services execute heavy stages. The device does not receive worker code, provider credentials, or provider-selection pointers.

For local development, run the API on port 8787 and the Expo web client on port 8081. The root `dev:mobile` and `web` scripts enter `apps/mobile` before starting Expo; keep root React/React Native peer versions aligned with the Expo SDK.

## Directory ownership

### `apps/api`

The TypeScript HTTP API. `server.ts` owns transport and routing, `auth.ts` verifies Firebase ID tokens, `validation.ts` owns input constraints, `domain.ts` owns capture/job creation, and `repository.ts`/`firestore-repository.ts` own the replaceable persistence interface and implementations.

The current `x-user-id` header is only a development identity boundary. Production uses verified Firebase ID tokens supplied by the API client token provider and `FIRESTORE_ENABLED=true`; ownership is enforced in both the API repository and Firestore rules.

### `apps/mobile`

The Expo Router app. Routes live in `app/`; shared UI and client configuration live in `src/`. The same React Native components are intended to run on iOS and web through React Native Web.

The current screen is intentionally narrow: save a URL, browse Inbox captures, search locally within the loaded list, inspect processing status, and tap the preserved source URL. It does not include Note Chat actions. `src/api.ts` centralizes the client construction so a Firebase session can replace the development identity for both iOS and web without duplicating auth logic.

### `apps/mobile/ios/SavedVideoShareExtension`

Native Swift source for the system Share Extension boundary. The eventual Xcode target should accept a URL or text containing a URL, authenticate the user, submit a small capture payload, and close. It must not save/download media, perform extraction, transcription, AI calls, or access-control bypasses.

### `packages/shared-types`

The shared source of truth for API/client capture and job contracts. Update this package before changing a field consumed by both the API and client.

### `packages/api-client`

The platform-neutral HTTP client. It currently supports list, detail, create, and retry capture operations. It accepts either a development user ID or an async Firebase ID-token provider; keep auth/session injection at this boundary rather than scattering headers through UI components.

### `packages/ingestion` and processing workers

`packages/ingestion` defines the metadata provider contract. `workers/metadata-worker` owns queue claiming and stage transitions without depending on the HTTP server. The worker must persist source metadata when available, preserve the original URL on failure, and never mark a capture `ready` until later processing stages actually complete.

`packages/processing` defines the provider-neutral stage order and backend
contracts. `workers/pipeline-worker` owns the generic one-stage transition,
review routing, and failure preservation for `extracting_media` through
`embedding`. `packages/processing/src/github-repository-discovery.ts` keeps
repository extraction, bounded query generation, ranking, and provenance
separate from the worker runtime. Provider implementations and production queue
adapters belong in backend worker services, not in `apps/mobile`.

## Adding the next feature

1. Update shared types if the API shape changes.
2. Update the API repository interface and route.
3. Add or update API tests for ownership and failure behavior.
4. Add the typed client method.
5. Add the shared Expo route/component for iOS and web.
6. Document native-only behavior in `apps/mobile/ios` when applicable.
7. Update the implementation guide’s current status and acceptance criteria when the milestone changes.

Keep provider interfaces behind backend boundaries. Never add API keys to Expo environment variables; `EXPO_PUBLIC_*` values are shipped to clients.
