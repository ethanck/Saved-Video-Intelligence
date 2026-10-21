# Saved Video Intelligence — Implementation Guide

## Product goal

Build an iOS-first app that turns saved TikTok, Instagram, YouTube, Safari, and web videos into searchable, user-owned knowledge. A user shares a link from any app; the system preserves the source, processes it asynchronously, extracts useful information, categorizes it, and exposes approved data to AI agents through MCP.

This is a separate product from Note Chat. They may share backend services and content IDs, but they should have separate interfaces and mental models:

- **Saved Video Intelligence:** capture, organize, search, recipes, skill candidates, recommendations, and MCP.
- **Note Chat:** active learning conversations, explanations, and evolving notes.

## Core user flow

1. The user taps the iOS Share button in TikTok, Instagram, Safari, or another app.
2. They select Saved Video Intelligence.
3. The Share Extension accepts a URL or text containing a URL.
4. The extension sends the payload to the backend and closes quickly.
5. The backend creates a queued capture record immediately.
6. Background workers fetch metadata, transcribe permitted media, extract visual/OCR information, summarize, classify, and index the item.
7. The user sees the item in a library with processing status, source link, summary, detailed notes, transcript, tags, and category.
8. The user can search manually, inspect the source, correct the classification, or expose the item to an AI agent through MCP.

TikTok and Instagram may provide only a URL and caption rather than the original video. The URL must always be preserved, and inaccessible sources must remain visible with a retry/manual-transcript path.

## Product surfaces

### Universal client (`apps/mobile`)

- Build the main client with Expo/React Native and Expo Router.
- Run the same component system on iOS and web through React Native Web.
- Library browsing
- Search and filters
- Collection management
- Item detail pages
- Recipe views
- Skill proposal review
- Processing status and retry controls
- Privacy, export, and MCP settings

The web build is a compatible authenticated application surface. It does not replace the native iOS Share Extension, which is required for reliable system share-sheet capture.

### iOS Share Extension

- Implement as a native Swift Share Extension target alongside the Expo app.
- Accept public URLs and shared text only. The product stores links and derived knowledge, not video/image files.
- Send a small authenticated capture payload to the backend.
- Show a short success state and close without performing heavy processing.
- Keep the extension free of provider credentials and media extraction logic.

The initial source boundary is documented in `apps/mobile/ios/SavedVideoShareExtension`. The Xcode target, entitlements, activation rules, native handoff, and mobile auth/session UI are still implementation work; the shared API client already supports Firebase ID-token injection.

Add the Share Extension as a native iOS target. Configure activation rules for public URLs and shared text. A phone cannot reach a development server at `127.0.0.1`; use a deployed HTTPS endpoint or a secure development tunnel.

### Knowledge Library

Use stable collections plus tags. Do not dynamically create nested folders for every capture.

Initial system collections:

- AI / Technical Knowledge
- Recipes
- Skill Candidates
- Learning
- Recommendations
- General Reference
- Inbox
- Needs Review

Users can create, rename, archive, delete, and reorder custom collections. An item can belong to multiple collections.

### Note Chat integration

Do not merge Note Chat’s UI into the Knowledge Library. Support optional cross-app deep links:

- “Discuss in Note Chat”
- “Save to Knowledge Library”
- “Open this recipe in Note Chat”
- “Save this conversation to the Knowledge Library”

The canonical recipe or knowledge item remains in the Knowledge Library. A related learning conversation remains in Note Chat.

## Processing pipeline

Implement durable background jobs with these stages:

```text
received
→ deduplicating
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

Each job needs a status, current stage, retry count, error message, created timestamp, updated timestamp, and completion timestamp.

If extraction fails, keep the capture with its URL, platform, caption, failure reason, retry action, and manual transcript input.

## Capture and knowledge data

Each captured source should preserve:

- Original URL
- Platform
- External source ID when available
- Title and caption
- Transcript and timestamped transcript segments
- Short summary
- Detailed notes
- Key frames
- OCR text
- Tags and collections
- Confidence score
- Processing provider and model
- User edits
- Usage count
- Related items
- Created and updated timestamps

Suggested entities:

```text
users
sources
captures
transcript_segments
knowledge_items
categories
tags
recipes
processing_jobs
usage_events
skill_proposals
skill_versions
mcp_audit_events
```

## Classification

The classifier should return structured JSON:

```json
{
  "primary_category": "recipe",
  "secondary_categories": [],
  "confidence": 0.94,
  "tags": ["pasta", "quick-dinner"],
  "requires_review": false,
  "suggested_action": "save"
}
```

Supported categories should include:

- `recipe`
- `ai_knowledge`
- `skill_candidate`
- `learning`
- `recommendation`
- `reference`
- `humor`
- `music`
- `travel`
- `product`
- `fitness`
- `finance`
- `health`
- `unknown`

Low-confidence items go to `Needs Review`. Health, financial, and legal material must receive additional warnings and must not silently become skills.

## Recipes

Recipes belong in the Knowledge Library and must be user-browsable, not hidden behind MCP.

Store:

- Recipe name
- Ingredients and quantities
- Steps
- Prep/cook/total time
- Servings
- Cuisine
- Dietary tags
- Substitutions
- Equipment
- Original source video
- User notes

Support queries such as:

- “What can I make with eggs and rice?”
- “Show recipes under 30 minutes.”
- “What vegetarian recipes do I have?”

## Skill lifecycle

There are two skill paths.

### Explicit skill capture

If the user selects “Save as skill” or clearly identifies a video as a skill recommendation, create a proposal immediately. Do not silently install it.

### Repeated knowledge usage

Track meaningful use events from MCP retrievals, user actions, or explicit “useful” actions. After three uses by default, create a proposal. Make the threshold configurable and allow the feature to be disabled.

Skill statuses:

```text
proposed → under_review → approved → exported
                    ↘ rejected
```

Every proposal should contain:

- Name and description
- Generated instructions
- Source URLs and source item IDs
- Confidence
- Detected commands and external URLs
- Requested permissions
- Safety analysis
- Version number
- Approval state

## Skill safety

Treat both generated and third-party skill content as untrusted.

Scan for:

- Shell commands
- Destructive commands
- Credential access
- Secret exposure
- Data exfiltration
- Suspicious network requests
- Dependency/package installation
- Prompt injection
- Hidden instructions that conflict with the user

For third-party skills mentioned in videos, show the source, author, permissions, dependencies, and trust status. Require explicit approval. Never claim that static scanning guarantees safety.

## Local Codex export

After explicit approval:

1. Persist the approved skill in the app database.
2. Generate a versioned `SKILL.md`.
3. Export it to a configurable local Codex skills directory.
4. Record the exported path and version.
5. Preserve source links and provenance.
6. Detect local edits before overwriting a skill.

The app is the source of truth. The local Codex skill is a synchronized projection.

## MCP server

Expose a remote, authenticated MCP endpoint backed by the same knowledge store. Start with read/search tools:

- `search_knowledge`
- `get_knowledge_item`
- `search_recipes`
- `get_recipe`
- `list_skill_proposals`
- `get_source_details`

Search results should include the query, item IDs, relevant excerpts, categories, tags, source URLs, confidence, and timestamps.

Use per-user scopes such as:

- `knowledge.read`
- `recipes.read`
- `skills.read`
- `sources.read`

Do not expose skill approval, installation, deletion, or collection-management writes through MCP in the first version. Keep those actions in the app.

Record MCP audit events so the user can inspect what an agent searched and which sources were returned.

## Suggested API

```text
POST   /v1/captures
GET    /v1/captures/:id
POST   /v1/captures/:id/retry

GET    /v1/items
GET    /v1/items/:id
PATCH  /v1/items/:id
POST   /v1/items/:id/use
DELETE /v1/items/:id

GET    /v1/categories
POST   /v1/categories
PATCH  /v1/categories/:id
DELETE /v1/categories/:id

GET    /v1/skills
GET    /v1/skills/:id
POST   /v1/skills/:id/approve
POST   /v1/skills/:id/reject
POST   /v1/skills/:id/export

GET    /v1/audit/searches
POST   /mcp
```

## Suggested repository layout

```text
saved-video-intelligence/
├── apps/
│   ├── api/
│   └── mobile/
│       ├── app/                         # Expo Router routes for iOS and web
│       ├── src/                         # shared React Native client UI
│       └── ios/SavedVideoShareExtension/ # Swift source boundary
├── packages/
│   ├── api-client/
│   ├── ingestion/
│   ├── shared-types/
│   ├── classifier/
│   ├── mcp-server/
│   └── skill-exporter/
├── workers/
│   ├── media-worker/
│   ├── transcription-worker/
│   └── classification-worker/
├── migrations/
├── docs/
├── tests/
├── docker-compose.yml
├── .env.example
└── README.md
```

Recommended production stack:

- Expo/React Native with Expo Router and React Native Web for the shared client
- Native Swift iOS Share Extension target
- TypeScript backend
- Firestore for authenticated per-user capture and job records
- A replaceable backend queue/worker runtime for asynchronous processing
- No permanent media storage; permitted temporary media is discarded after processing
- MCP Streamable HTTP endpoint
- Provider interfaces for transcription, vision, summaries, and classification

The current implementation uses a local JSON repository by default and includes a Firestore adapter. Storage and queue interfaces must remain replaceable as the product moves toward production workers.

## Security and privacy

Implement:

- Authentication and per-user data isolation
- Authenticated MCP access
- HTTPS outside local development
- Rate limits and file-size limits
- URL validation and SSRF protection
- Uploaded-file malware scanning
- Audit logging
- Deletion and complete data export
- No API keys in the iOS client
- Backend-only provider credentials

## Milestones

### Current implementation status

The repository now contains the first backend and universal-client vertical slice for Milestone 1:

- A TypeScript API scaffold under `apps/api`.
- `POST /v1/captures` accepts a public URL or text containing a URL, preserves the source link, and creates a queued processing job.
- `GET /v1/captures` and `GET /v1/captures/:id` provide user-scoped library reads.
- `POST /v1/captures/:id/retry` requeues a capture without doing heavy work in the request path.
- A local JSON repository keeps the storage boundary replaceable for Firestore.
- Firebase project `saved-video-intelligence` is created and bound in `.firebaserc`; Google/email-password Authentication is enabled, and Firestore is live in `us-east1` with owner-scoped rules/indexes.
- Shared contracts in `packages/shared-types` and a typed client in `packages/api-client`.
- A GitHub repository discovery stage that extracts explicit links, performs bounded contextual searches when enabled, and persists ranked candidates with provenance.
- A metadata provider interface in `packages/ingestion` and a queue-aware worker in `workers/metadata-worker`.
- A local metadata worker runner that advances only the initial stage and never fabricates a completed knowledge item.
- An Expo Router app in `apps/mobile` that runs on iOS and web through React Native Web.
- The shared Inbox displays capture failures and uses the typed client to requeue them.
- The shared client includes a capture detail route with processing history and source provenance.
- A documented native Swift Share Extension boundary under `apps/mobile/ios`.
- Tests cover API capture behavior, client transport/error handling, worker transitions, and per-user isolation.
- The Node 24/npm 11 install is aligned with Expo SDK 57; the 20-test suite and TypeScript build pass, and Expo web has been smoke-tested on port 8081.

The API has an authenticated-session transport boundary and a deployed Firestore adapter, but the mobile sign-in/session UI, generated Xcode target, media/transcription/summary/classification workers, recipes, MCP server, and end-to-end production credentials are intentionally not implemented yet.

### Milestone 1 — Capture

Complete: capture endpoint, persistent local/Firestore boundaries, job records, basic Expo iOS/web library view, source provenance, retry flow, and the documented Share Extension boundary.

Remaining: mobile sign-in/session UI, generated Xcode target and entitlements, production API deployment, and an end-to-end phone share-sheet test.

### Milestone 2 — Extraction

- Metadata extraction
- Media/provider adapters
- Transcription
- Summaries
- Classification
- Recipe extraction
- Retry/status UI

### Milestone 3 — Search and MCP

- Full-text search
- Semantic search
- Authenticated MCP endpoint
- Scoped tools
- Search audit log

### Milestone 4 — Skills

- Usage tracking
- Three-use threshold
- Skill proposal UI
- Safety analysis
- Approval/rejection
- Versioned Codex export
- Conflict detection

### Milestone 5 — Production

- Cloud deployment
- Object storage
- User accounts
- Notifications
- Privacy controls
- TestFlight build

## Acceptance criteria

The implementation is complete only when:

- A user can share a TikTok or Instagram URL from iOS.
- The URL is stored without copy/paste.
- Processing runs asynchronously with visible status.
- The item receives a category and tags.
- The user can browse, search, edit, and delete it.
- Recipes are structured and user-visible.
- MCP can search knowledge and recipes.
- MCP results include provenance and source links.
- MCP usage is logged.
- Three meaningful uses create a skill proposal.
- The user can approve or reject it.
- Approval exports a versioned local `SKILL.md`.
- No skill is silently installed.
- Third-party skill recommendations receive safety review.
- Failed sources remain visible and retryable.
- Users can export and delete their data.

Do not build the 3D galaxy knowledge graph in the first version. Establish reliable capture, extraction, search, provenance, MCP access, and skill review first.
