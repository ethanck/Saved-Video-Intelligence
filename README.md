# Saved Video Intelligence

An iOS-first personal Knowledge Library with a compatible web app. Save public links or shared media from TikTok, Instagram, YouTube, Safari, and other apps; preserve the source; process it asynchronously; and make the resulting knowledge searchable by the user and approved AI agents.

This product is separate from Note Chat. The Knowledge Library owns capture, organization, recipes, skill review, provenance, and MCP access. Note Chat owns conversations and learning notes.

## Architecture

```text
iOS Share Extension (Swift)
        ↓ small authenticated capture payload
Expo / React Native app ──┐
Expo Web (React Native Web) ─┴─ @svi/api-client → TypeScript API → repository boundary
                                                     ↓
                                           queued processing jobs/workers
```

- `apps/mobile`: Expo Router client shared by iOS and web. The first screen implements capture plus Inbox browsing.
- `apps/mobile/ios/SavedVideoShareExtension`: native Swift boundary for the iOS share sheet. It must stay lightweight.
- `apps/api`: backend capture API and job persistence.
- `apps/api/src/auth.ts` and `apps/api/src/firebase.ts`: Firebase ID-token verification and lazy Admin initialization.
- `apps/api/src/firestore-repository.ts`: Firestore persistence adapter selected with `FIRESTORE_ENABLED=true`.
- `packages/shared-types`: source of truth for client/API domain contracts.
- `packages/api-client`: platform-neutral typed HTTP client used by Expo and future web entry points.
- `packages/processing` and `workers/pipeline-worker`: provider-neutral processing-stage contracts and one-stage-at-a-time backend orchestration.
- `workers/transcription-worker`, `workers/repository-discovery-worker`, and `workers/worker-runtime`: ordered transcript fallback handling, GitHub repository discovery, and deployable Cloud Run HTTP entry points.
- `tests`: API behavior tests.

The local default remains a JSON store with a development-only `x-user-id` header. Production uses verified Firebase ID tokens through the API client’s token provider and can select Firestore with `FIRESTORE_ENABLED=true`; service-account credentials must remain server-side.

The current dependency baseline is Expo SDK 57 with React Native 0.86.3, React 19.2.3, Node.js 24, and npm 11. The root mobile scripts enter `apps/mobile` so Metro resolves the correct Expo configuration and workspace versions.

Firebase project binding is configured in `.firebaserc` for `saved-video-intelligence`. Google plus email/password Authentication providers are enabled. Firestore is live in `us-east1` with owner-scoped rules and indexes. The product is link-only: temporary media may be processed by a future worker, but Firestore retains source links and derived knowledge, never video files.

## Current implementation

Implemented:

- `POST /v1/captures` accepts a public URL or text containing a URL, preserves the source link, and creates a queued processing job.
- `GET /v1/captures` and `GET /v1/captures/:id` provide user-scoped library reads.
- `POST /v1/captures/:id/retry` requeues a capture without doing heavy work in the request path.
- `POST /v1/captures/:id/github-repositories/select` records an authenticated accept/reject decision for a repository suggestion.
- Local JSON repository with a replaceable `KnowledgeRepository` interface.
- Shared TypeScript contracts and a reusable API client.
- Expo/React Native library screen that also runs on web through React Native Web.
- Capture detail route with processing history, preserved source, error state, and retry action.
- Capture detail route includes a manual transcript fallback that resumes repository discovery.
- Failed captures show their error and can be requeued from the shared iOS/web Inbox.
- Native Share Extension source boundary and integration documentation.
- Firebase Admin authentication and Firestore repository adapters behind the existing interfaces.
- API-client support for async Firebase ID-token injection, while retaining the local development header path.
- Provider-neutral stage contracts and a generic pipeline worker for media extraction through embeddings, with safe review and failure transitions.
- Safe public HTML metadata extraction for the first worker stage, including title, description, author, thumbnail, and canonical URL where available.
- Deployable API/worker Dockerfiles and Cloud Run configuration guidance.
- Transcript records stored separately from captures, with auditable fallback attempts and a manual transcript endpoint.
- GitHub repository discovery stage with explicit-link extraction, bounded contextual search, ranked candidates, provenance evidence, and review status.
- Tests for API capture behavior, client transport/error handling, worker transitions, and per-user isolation.

Not yet implemented: mobile sign-in/session UI, the Xcode target wiring, real media/transcription provider implementations, managed queue activation, final downstream classification/recipes/MCP, user confirmation for repository candidates, and skill review/export. The API and initial private Cloud Run worker boundaries are deployed, but the transcription worker still safely routes to review until providers are configured.

Validated baseline: `npm test` passes all 10 tests, `npm run build` completes, the API responds on port 8787, and `npm run web` serves the Expo web bundle on port 8081.

## Local development

The project is pinned to Node.js 24 with npm 11. `.nvmrc` contains the major version for nvm/asdf users:

```sh
npm install
npm test
npm run build
npm run dev              # API
npm run dev:metadata-worker # metadata-stage queue worker
npm run dev:mobile       # Expo iOS/Metro development server
npm run web              # Expo web development server
```

The root mobile scripts change into `apps/mobile` before starting Expo so Metro reads the mobile `app.json` and workspace dependencies. The web app is served at the URL Expo prints, normally `http://localhost:8081`.

If Expo dependencies change, run `npx expo install --fix` from `apps/mobile`, then reinstall from the repository root with Node 24/npm 11.

The API uses the local JSON repository by default. For a server with Firebase Admin credentials or Application Default Credentials, set `FIRESTORE_ENABLED=true`; production requests must send `Authorization: Bearer <Firebase ID token>`.

Verify the runtime before installing dependencies:

```sh
node --version  # v24.x
npm --version   # v11.x
```

The API listens on `http://127.0.0.1:8787` by default. `DATA_FILE` controls the local JSON store location.
When the Expo web app runs on port 8081, the API allows the local `localhost:8081`
and `127.0.0.1:8081` origins by default. Set `CORS_ORIGINS` to a comma-separated
allowlist for another development or deployed web origin.

For a physical phone, set `EXPO_PUBLIC_API_URL` to a LAN-reachable HTTPS or development-tunnel URL. `127.0.0.1` refers to the device itself on a physical phone. `EXPO_PUBLIC_DEV_USER_ID` controls the temporary development identity used by the client.

## Capture example

```sh
curl -X POST http://127.0.0.1:8787/v1/captures \
  -H 'content-type: application/json' \
  -H 'x-user-id: demo-user' \
  -d '{"url":"https://www.youtube.com/watch?v=example","title":"Example video"}'
```

The endpoint returns `202 Accepted`, the persisted capture, and a queued processing job. The request path does not download media or call an AI provider. Run the metadata worker separately to claim the initial queue stage; it fetches only a bounded public HTML response and advances the job to `extracting_media` with any safe metadata it can read. If automated transcript methods are unavailable, submit `POST /v1/captures/:id/transcript` to store a manual transcript and resume at `discovering_repositories`. Repository candidates are available on capture detail responses after that stage runs.

The product is link-only. If a future worker temporarily fetches permitted media for processing, that temporary data must be discarded after processing; Firestore stores the source link and derived knowledge, never video files.

## Documentation map

- [`AGENTS.md`](./AGENTS.md): rules and durable constraints for coding agents.
- [`IMPLEMENTATION_GUIDE.md`](./IMPLEMENTATION_GUIDE.md): product decisions, milestones, data model, security, and acceptance criteria.
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md): code ownership, runtime flow, and feature-change workflow.
- [`docs/PROCESSING_PIPELINE.md`](./docs/PROCESSING_PIPELINE.md): Firebase/Google Cloud deployment boundary and processing-stage design.
- [`docs/CODEBASE_INVENTORY.md`](./docs/CODEBASE_INVENTORY.md): purpose of source/configuration files and cleanup rules.
- [`.firebaserc`](./.firebaserc): active Firebase project binding.
- [`apps/mobile/README.md`](./apps/mobile/README.md): Expo, iOS, web, and Share Extension client guidance.
- [`apps/mobile/ios/SavedVideoShareExtension/README.md`](./apps/mobile/ios/SavedVideoShareExtension/README.md): native share-sheet integration boundary.
