# Cloud Run deployment boundary

The API and worker services are separate Cloud Run services. They share the
same source repository but scale and authenticate independently.

## Provisioned project baseline

The Firebase/Google Cloud project is `saved-video-intelligence` in `us-east1`.
The following shared resources are provisioned:

- Cloud Tasks queue: `svi-processing`
- Artifact Registry Docker repository: `us-east1-docker.pkg.dev/saved-video-intelligence/svi`
- API runtime service account: `svi-api-runtime@saved-video-intelligence.iam.gserviceaccount.com`
- Worker runtime service account: `svi-worker-runtime@saved-video-intelligence.iam.gserviceaccount.com`
- Cloud Tasks dispatcher service account: `svi-task-dispatcher@saved-video-intelligence.iam.gserviceaccount.com`

Deployed services:

- API: `https://svi-api-dwstx3p4nq-ue.a.run.app`
- Metadata worker (`received`): `https://svi-metadata-worker-dwstx3p4nq-ue.a.run.app`
- Media boundary worker (`extracting_media`): `https://svi-media-worker-dwstx3p4nq-ue.a.run.app`
- Transcription worker (`transcribing`): `https://svi-transcription-worker-dwstx3p4nq-ue.a.run.app`
- Repository discovery worker (`discovering_repositories`): `https://svi-repository-discovery-worker-dwstx3p4nq-ue.a.run.app`

The API is publicly reachable at the network layer and requires Firebase ID
tokens for data routes. Workers are private and accept Cloud Run IAM callers.
Cloud Run Invoker permissions are granted to the Cloud Tasks dispatcher.
Managed dispatch is active for the MVP stages (`received`, `transcribing`, and
`discovering_repositories`); future media/OCR/knowledge stages remain inactive.

## Build images

From the repository root:

```sh
gcloud builds submit --config infra/cloudbuild.api.yaml .

gcloud builds submit --config infra/cloudbuild.worker.yaml .
```

Replace `REGION` and `PROJECT_ID` with the deployment project values. Do not
put provider keys in these commands or in image layers.

## API service

Deploy the API with:

```sh
gcloud run deploy svi-api \
  --image REGION-docker.pkg.dev/PROJECT_ID/svi/api \
  --region us-east1 \
  --set-env-vars FIRESTORE_ENABLED=true,FIREBASE_PROJECT_ID=saved-video-intelligence \
  --allow-unauthenticated
```

The API service is publicly reachable at the network layer so the mobile app
can call it, but every data route still requires a Firebase ID token inside the
API. The mobile client receives only the API URL and Firebase Auth
configuration.

## Worker service

Create the managed queue once per environment:

```sh
gcloud tasks queues create svi-processing --location us-east1
```

The API needs `CLOUD_TASKS_ENABLED=true`, the queue project/location/name, the
default worker task URL or one stage-specific worker URL per active stage, and
a service account email that Cloud Tasks may use for its OIDC token. Grant that
service account permission to invoke every private worker service before
enabling dispatch. Stage-specific variables such as
`CLOUD_TASKS_WORKER_URL_DISCOVERING_REPOSITORIES` override the default URL.

Deploy one worker service per active stage, using the same worker image and a
different `WORKER_STAGE` value:

```sh
gcloud run deploy svi-transcription-worker \
  --image REGION-docker.pkg.dev/PROJECT_ID/svi/worker \
  --region us-east1 \
  --set-env-vars FIRESTORE_ENABLED=true,FIREBASE_PROJECT_ID=saved-video-intelligence,WORKER_STAGE=transcribing,WORKER_TRUST_CLOUD_RUN_IAM=true \
  --no-allow-unauthenticated
```

Cloud Tasks or Pub/Sub should invoke `/tasks/process` with a Google-signed
identity. `WORKER_AUTH_TOKEN` is supported for local or transitional setups but
should not replace Cloud Run IAM in the final deployment. The current runtime
uses explicitly unconfigured providers, so it safely routes work to review
until real permitted providers are wired in.

The service that will perform actual video/audio handling is the worker deployed
with `WORKER_STAGE=extracting_media`. The service deployed with
`WORKER_STAGE=transcribing` runs the ordered caption/ASR fallback chain. Both
currently expose safe unconfigured handlers; provider implementations are the
next backend addition.

Deploy the repository discovery stage as a separate private worker service:

```sh
gcloud run deploy svi-repository-discovery-worker \
  --image REGION-docker.pkg.dev/PROJECT_ID/svi/worker \
  --region us-east1 \
  --set-env-vars FIRESTORE_ENABLED=true,FIREBASE_PROJECT_ID=saved-video-intelligence,WORKER_STAGE=discovering_repositories,WORKER_TRUST_CLOUD_RUN_IAM=true,GITHUB_DISCOVERY_ENABLED=true \
  --set-secrets GITHUB_TOKEN=github-token:latest \
  --no-allow-unauthenticated
```

The discovery worker first persists explicit GitHub URLs or repository slugs
without needing a network call. When enabled, it sends only bounded search
phrases—not the full transcript—to the GitHub repository search API. Results
are stored in `githubRepositoryDiscoveries` with confidence, evidence, and
review status. Keep the GitHub token in Secret Manager; never put it in the
mobile app or a committed environment file.
