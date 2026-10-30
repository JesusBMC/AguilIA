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

## Install, build, test

```sh
bun install            # install dependencies
bunx tsc --noEmit      # type-check the whole project (local + aws providers)
bun test               # run the full test suite (providers, rules, draft, pipeline, server)
```

All three are green from a clean checkout. The server tests run in-process via Hono's `app.fetch(new Request(...))` — no socket is opened and nothing is left running.

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

## Infrastructure as code

`iac/template.yaml` is a CloudFormation template for the AWS serverless target: S3 (documents, versioned + encrypted), DynamoDB (`agilia-traceability`, `agilia-findings`), SQS + DLQ, EventBridge (the event-driven processing chain), Cognito (user pool + groups — the production auth boundary), Secrets Manager, OpenSearch (in-VPC), a VPC with public/private subnets and NAT, least-privilege IAM, Python Lambdas, API Gateway (Cognito-authorized), CloudWatch dashboards/alarms, X-Ray, and CloudTrail.

This MVP **extends** the existing template (no existing resource was removed or rewritten) with:

- `DraftRetrieverFunction` (reads the draft from S3 + version history from DynamoDB) backing `GET /documents/{documentId}` and `GET /documents/{documentId}/draft`.
- `SearchHandlerFunction` + a dedicated least-privilege `SearchHandlerRole` (OpenSearch read-only + VPC access), backing `GET /search`.
- The matching `AWS::Lambda::Permission` entries for API Gateway to invoke each new function, and the new methods added to `ApiGatewayDeployment.DependsOn`.
- A fix to the EventBridge chain: `TextractProcessorFunction` emits detail-type `ExtractionStarted`, but `TextExtractedRule` matched the stale value `TextExtracted`, so the Textract → Comprehend hop never fired. The rule now matches `ExtractionStarted` (documented inline in the template).

Lint / validate the template with the AWS CLI or `cfn-lint`:

```sh
aws cloudformation validate-template --template-body file://iac/template.yaml
# or
cfn-lint iac/template.yaml
```

## Known MVP gaps

- **No local authentication.** The local Hono server is unauthenticated by design; **Amazon Cognito is the production auth boundary** (wired in `iac/template.yaml` on every API Gateway method). This is surfaced loudly (server boot warning + UI banner), never silent.
- **Thin AWS provider.** `src/providers/aws/` compiles, constructs real SDK clients, calls each service, and handles SDK errors — but response-to-domain mapping is intentionally minimal. Incomplete spots are marked `// FUTURE WIRING` (e.g. Textract block → structured fields, Bedrock output → typed findings/sections, DynamoDB per-attribute projection, OpenSearch SigV4 signing). The local bundle is the complete, demoable path.
- **DOCX export deferred.** Drafts are structured sections plus editable **Markdown** (viewed/downloaded in the UI). DOCX generation is a future enhancement; editable Markdown satisfies the editable-format requirement for the MVP.
- **Operational requirements deferred.** R13/R15/R16/R17 (operational concerns) are out of scope for this MVP and are handled at the infrastructure/operations layer (`iac/template.yaml` observability, alarms, audit trail) rather than in application code.

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
| R9 — authentication | **Deferred locally**; Cognito is the production boundary (IaC) |
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
scripts/seed.ts    # seeded sample runner (bun run seed)
tests/             # bun:test suites (providers, rules, draft, pipeline, server)
iac/template.yaml  # CloudFormation for the AWS serverless target
```
