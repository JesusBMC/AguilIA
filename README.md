# AgilIA

AgilIA is a document-intelligence and rule-engine service that helps public-sector teams prepare and review procurement documentation ("estudios previos" and the derived FTN / FTP / Carta de intención drafts). It extracts structured data from a procurement document, runs real business rules over it to surface inconsistencies and risk alerts (each with a location in the source, quoted evidence, and a technical explanation), generates an editable draft with placeholders for missing fields and markers on flagged fields, records human ACCEPT/REJECT decisions for full traceability, and indexes findings for search. It runs fully offline for demos and development, with a thin AWS wiring layer for the production serverless target.

## Local vs AWS provider model

The whole pipeline (extract → analyze → validate → alert → draft → persist) depends only on seven service interfaces (`DocumentExtractor`, `NlpAnalyzer`, `RuleValidator`, `DraftGenerator`, `Storage`, `TraceStore`, `SearchIndex` in `src/providers/interfaces.ts`). Two concrete bundles implement them:

- **`local`** (default) — fully offline and deterministic. No network, no AWS SDK. Filesystem storage under `.data/`, an in-memory BM25 search index, deterministic NLP, and the real rule engine in `src/rules/`. This is what the demo, tests, and `bun run dev` use.
- **`aws`** — a *thin* bundle wired to the real AWS services (S3, DynamoDB, OpenSearch, Textract, Comprehend, Bedrock). It compiles and calls each service; where response-to-domain mapping is not yet complete it is marked with `// FUTURE WIRING` comments rather than silent no-ops. See [Known MVP gaps](#known-mvp-gaps).

Selection is by the `AIDLC_PROVIDER` environment variable, read in `src/config.ts`:

```
AIDLC_PROVIDER=local   # default — anything other than "aws" resolves to local
AIDLC_PROVIDER=aws     # load the thin AWS bundle
```

`src/providers/index.ts` resolves the bundle. For `aws` it loads `./aws/index.ts` through a **dynamic `import()`**, so the local runtime never loads the AWS SDK at all. The AWS bundle reads non-secret resource identifiers (region, bucket, table names, OpenSearch endpoint) from the environment — see `.env.example`. It never hardcodes credentials; use your normal AWS credential chain.

## Requirements

- **[bun](https://bun.sh) 1.4.4+** as both runtime and package manager. `node` and `git` are not required.
- That's it — TypeScript is a dev dependency and runs via `bunx tsc`.
- To deploy to AWS you also need git, Terraform ≥ 1.10 (1.11+ recommended) and AWS CLI v2 with credentials; see [docs/despliegue-aws.md](docs/despliegue-aws.md).

## Install, build, test

```sh
bun install            # install dependencies
bunx tsc --noEmit      # type-check the whole project (local + aws providers)
bun test               # run the full test suite (providers, rules, draft, pipeline, server, lambda, infra)
bun run build:lambda   # bundle the two AWS Lambdas into dist/lambda/{api,worker}/index.mjs
bun run verify:lambda  # import the bundles and invoke GET /health offline (no AWS calls)
```

The first three are green from a clean checkout; the Lambda commands are only needed before a Terraform deploy. The server tests run in-process via Hono's `app.fetch(new Request(...))` — no socket is opened and nothing is left running.

## Run the local demo

Start the local server (listens on `PORT`, default `8787`):

```sh
bun run dev
```

Then open <http://localhost:8787> in a browser. The single-page UI (`web/`) walks the full flow across four screens — cargar → datos → borradores → exportar — driving the local API: upload a bundled sample, render extracted data + findings + risk alerts, view/download the generated draft, and record ACCEPT/REJECT decisions.

> ⚠️ **No authentication locally.** The local server has no auth by design — Amazon Cognito is the production authentication boundary (see gaps below). The server logs this warning on boot and the UI shows a visible "MVP: sin autenticación" banner.

### Seeded sample flow

To run the seeded inconsistencias sample straight through the pipeline and print the resulting document id, status, finding count, and rules fired (no server needed):

```sh
bun run seed
```

This loads `samples/estudio_previo_pgn_inconsistencias.txt` (the PGN `AGL-2026-PGN41` case, seeded with the demo defects: a sin-IVA vs total-con-IVA value mismatch, a closed "Mac" brand without "o equivalente", and a restrictive experience requirement) and writes runtime state under `.data/`.

### HTTP API

The local server mirrors the API Gateway design (same paths, no auth locally):

| Method & path | Purpose |
|---|---|
| `POST /documents/upload` | Run the pipeline on an uploaded document; returns `{documentId, status, extracted, findings, alerts}` |
| `GET /documents/:id` | Fetch the full persisted record |
| `GET /documents/:id/draft` | Fetch the generated draft (`?download=1` for an attachment) |
| `POST /documents/:id/decision` | Record an ACCEPT/REJECT decision (justification required on REJECT) |
| `GET /search?q=` | Lexical search over findings |
| `GET /health` | Liveness probe: `{"status":"ok","auth":"none"}` locally, `"auth":"cognito"` on AWS |

`POST /documents` is an alias of `POST /documents/upload`. On AWS every route except `GET /health` requires a Cognito ID token in the `Authorization` header, and the upload is asynchronous (202 + polling, see [Infrastructure as code](#infrastructure-as-code)).

## Infrastructure as code

The AWS deployment (region `us-east-2`) is defined with **Terraform** under `infra/terraform/`. It replaces the earlier CloudFormation template, which has been removed. Everything in AWS is created, updated and destroyed with Terraform.

- **Step-by-step deployment guide (Spanish, PowerShell + bash):** [docs/despliegue-aws.md](docs/despliegue-aws.md). It covers prerequisites, credentials, Bedrock access, the first Cognito user, smoke tests, updates, rollback, teardown, troubleshooting and estimated costs.
- **Architecture (Spanish, Mermaid diagram + text version):** [docs/terraform-arquitectura.md](docs/terraform-arquitectura.md).

Layout:

```
infra/terraform/
  bootstrap/   # run once per account, local state: S3 state bucket, AWS Budgets, writes envs/dev/backend.hcl
  envs/dev/    # the dev environment root, remote state in S3 with native locking (use_lockfile)
  modules/     # storage, messaging, auth, lambda_function, api, frontend, search, observability
```

What `envs/dev` deploys:

- **Two Node.js Lambdas built from this repo** by `bun run build:lambda` (`dist/lambda/{api,worker}/index.mjs`, zipped by Terraform). `agilia-api-dev` runs the same Hono app behind API Gateway (REST, Cognito authorizer on every route except `GET /health`). `agilia-worker-dev` consumes the SQS queue and runs the full pipeline with the AWS providers (Textract, Comprehend, Bedrock, S3, DynamoDB). Both publish versions behind a `live` alias, which is the fast-rollback point.
- **Asynchronous upload on AWS.** `POST /documents/upload` (and its alias `POST /documents`) stores the input in S3, queues it in SQS, emits an EventBridge event and returns **202** `{documentId, status: "RECEIVED"}`. The SPA polls `GET /documents/{id}` until `DRAFTED` or `ERROR`. Locally the route stays synchronous (201).
- **SPA on S3 + CloudFront** (private bucket, OAC). The API is served through the same distribution, so the browser calls it same-origin. Terraform uploads `web/` and a generated `config.js` with the Cognito settings; users sign in through the Cognito hosted UI (OAuth code + PKCE).
- S3 documents bucket, DynamoDB traceability and findings tables, SQS queue + DLQ, EventBridge bus, Cognito user pool and groups, an optional Secrets Manager secret, CloudWatch alarms and dashboard, SNS alerts topic, X-Ray group and CloudTrail.

Cost controls are variables in `envs/dev/terraform.tfvars`: `enable_opensearch` (default `false`; search then runs over the DynamoDB findings table), `enable_cloudtrail`, `enable_xray_tracing`, `enable_pitr`, `enable_rules_secret`, API throttling and `worker_max_concurrency`. The VPC, NAT Gateway and ElastiCache from the old template are omitted because no code needs them. The bootstrap root creates an **AWS Budgets** monthly budget (default USD 100 with e-mail alerts at USD 20/50/80, credits excluded so the alerts fire).

Validate offline (no AWS credentials needed):

```sh
terraform fmt -check -recursive infra/terraform
terraform -chdir=infra/terraform/bootstrap init -backend=false
terraform -chdir=infra/terraform/bootstrap validate
terraform -chdir=infra/terraform/envs/dev init -backend=false
terraform -chdir=infra/terraform/envs/dev validate
```

## Known MVP gaps

- **No local authentication.** The local Hono server is unauthenticated by design; **Amazon Cognito is the production auth boundary** (defined in `infra/terraform/` on every API Gateway method except `GET /health`). This is surfaced loudly (server boot warning + UI banner), never silent.
- **AWS path validated offline only.** Nothing has been applied to a real AWS account from the development machine. The AWS path is checked with `terraform validate`, the bun test suite and `bun run verify:lambda` (which imports the bundles in bun, not in the Lambda Node.js runtime). The first real deploy is the end-to-end test; [docs/despliegue-aws.md](docs/despliegue-aws.md) lists the smoke tests.
- **Thin AWS provider.** `src/providers/aws/` compiles, constructs real SDK clients, calls each service, and handles SDK errors — but response-to-domain mapping is intentionally minimal. Incomplete spots are marked `// FUTURE WIRING` (e.g. Textract block → structured fields, Bedrock output → typed findings/sections, DynamoDB per-attribute projection). The local bundle is the complete, demoable path.
- **AWS session limits.** The SPA does not renew tokens (sign in again after about 1 hour) and routes do not check Cognito groups. Lambda request payloads are capped at 6 MB, so large `contentBase64` uploads fail; the SPA sends text. Without OpenSearch, search scans the DynamoDB findings table (fine at MVP volume).
- **DOCX export deferred.** Drafts are structured sections plus editable **Markdown** (viewed/downloaded in the UI). DOCX generation is a future enhancement; editable Markdown satisfies the editable-format requirement for the MVP.
- **Operational requirements deferred.** R13/R15/R16/R17 (operational concerns) are out of scope for this MVP and are handled at the infrastructure/operations layer (`infra/terraform/` observability, alarms, audit trail) rather than in application code.

### R1–R12 coverage

| Req | Coverage in this MVP |
|-----|----------------------|
| R1 — extraction | `LocalDocumentExtractor` + `src/rules/field-extraction.ts` (AWS: Textract, thin) |
| R2 — guidance / placeholders | `LocalDraftGenerator` emits `[[COMPLETAR: …]]` for missing fields |
| R3 — editable draft | Structured sections + editable Markdown (DOCX deferred) |
| R4 — user control / versions | ACCEPT/REJECT decisions + version history in `TraceStore` |
| R5 — location / search | Findings carry `location`; `SearchIndex` (local BM25 / AWS OpenSearch) |
| R6 — evidence + explanation | Each finding carries quoted `evidence` + a technical `message` |
| R7 — decisions | `POST /documents/:id/decision`, persisted and auditable |
| R8 — version history | `TraceStore.addVersion` / `listVersions`, per-document |
| R9 — authentication | **Deferred locally**; Cognito is the production boundary (Terraform, SPA hosted-UI login) |
| R10 — institutional rules source | Local `src/rules/rule-definitions.ts` stands in for Secrets Manager |
| R11 — coherence validation | The seven real rules in `rule-definitions.ts` (coherence/inconsistency) |
| R12 — risk alerts | HIGH-severity findings carry a `riskAlert` early warning |

The seven business rules (`R-CAMPO-OBLIGATORIO`, `R-PRESUPUESTO-CDP`, `R-VALOR-INCONSISTENTE`, `R-MARCA-CERRADA`, `R-EXPERIENCIA-RESTRICTIVA`, `R-FECHAS-COHERENTES`, `R-MODALIDAD-CUANTIA`) are real business logic — none always-pass or always-fail — each producing a finding with location, evidence, and explanation, and a risk alert for HIGH-severity cases.

## Project layout

```
src/domain/        # shared domain types
src/providers/     # interfaces + selector; local/ (offline) and aws/ (thin) bundles
src/rules/         # field extraction + the business rule definitions
src/pipeline/      # the extract→analyze→validate→draft→persist orchestrator
src/server/        # Hono app, routes, zod schemas, error handling
web/               # static single-page UI (Tailwind CDN)
samples/           # plain-text estudios previos (clean + seeded-defects)
src/lambda/        # AWS Lambda entry points: api (Hono behind API Gateway) and worker (SQS)
scripts/seed.ts    # seeded sample runner (bun run seed)
scripts/build-lambda.ts, scripts/verify-lambda-bundle.ts  # bun run build:lambda / verify:lambda
tests/             # bun:test suites (providers, rules, draft, pipeline, server, lambda, infra)
infra/terraform/   # Terraform for the AWS deployment (bootstrap, envs/dev, modules)
docs/              # Spanish deployment guide and architecture (despliegue-aws.md, terraform-arquitectura.md)
```
