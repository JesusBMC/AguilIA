# Implementation Plan — AgilIA MVP (runnable TODAY, local-first)

> Workspace root (all paths absolute): `c:\Users\jparrap\AgilIA-AWS`
> Runtime/package manager: **bun 1.4.4** (node and git are NOT installed — no git/commit/worktree steps anywhere).
> Stack: Node/TypeScript on bun. Provider abstraction: `AIDLC_PROVIDER=local|aws` (default `local`).
> Do NOT touch `.kiro/` or `aidlc-docs/` (read-only knowledge). Ignore root scratch files (`*.txt`, `buntest.ts`).
> Verification uses `bun test`, `bunx tsc --noEmit`, and `bun build`. The HTTP server is never left running/blocking — all server verification uses an in-process start→request→close harness inside `bun test`.

## Design decisions (made here, grounded in the repo)

1. **Provider abstraction, 7 interfaces** — `DocumentExtractor, NlpAnalyzer, RuleValidator, DraftGenerator, Storage, TraceStore, SearchIndex`. Chosen because AWS cannot run locally today; the `local` provider makes the whole pipeline demoable offline while the `aws` provider is the real future wiring point. The provider selector uses a **dynamic `import()`** for the aws module so the local runtime never loads the AWS SDK.
2. **HTTP framework: Hono.** Lightweight, first-class bun support, trivially testable in-process via `app.fetch(request)` with no listening socket — which is exactly how we verify on Windows PowerShell without a blocking server.
3. **Draft format: structured JSON + Markdown rendering** (not DOCX). Keeps the local generator deterministic and dependency-free; the UI shows/downloads Markdown. DOCX export is noted as a future enhancement on the aws path (R3 editable-format is satisfied by editable Markdown for the MVP).
4. **Rules are real, not stubs.** The validator mirrors the exact inconsistencies the existing `product-final.html` demo surfaces (value sin-IVA vs con-IVA mismatch, closed brand "Mac", restrictive experience) plus structural coherence rules, each emitting a finding with location + textual evidence + technical explanation, and risk alerts for HIGH-severity findings.
5. **No auth locally — stated, not silent.** The local server has no Cognito; every response path and the README flag this as the known MVP security boundary.

## Domain field model (extracted from a procurement "estudio previo")

`ExtractedData` fields the extractor/validator work with: `entidad`, `procesoId`, `objeto`, `modalidad`, `valorSinIva` (number), `valorTotalConIva` (number), `cdpNumero`, `cdpValor` (number), `fechaPublicacion`, `fechaCierre`, `plazoEjecucion` (text + parsed days), `items[]` (`{ numero, descripcion, cantidad, marca? }`), `experienciaExigida`, `garantias`. Each field carries `{ value, location: { page?, section?, line?, charStart?, charEnd? }, evidence }`.

## Concrete local business rules (each → Finding, some → RiskAlert)

| ruleId | Condition | severity | category | riskAlert |
|--------|-----------|----------|----------|-----------|
| `R-CAMPO-OBLIGATORIO` | required field missing (`objeto, valorSinIva, modalidad, cdpNumero, entidad, plazoEjecucion`) | MEDIUM (HIGH if `objeto`/`valorSinIva`) | MISSING_FIELD | HIGH only |
| `R-PRESUPUESTO-CDP` | `valorSinIva > cdpValor` (budget exceeds available funds) | HIGH | COHERENCE | yes |
| `R-VALOR-INCONSISTENTE` | same magnitude referenced with conflicting amounts (e.g. FTN sin IVA vs Carta total con IVA presented as the same "valor máximo") | HIGH | INCONSISTENCY | yes |
| `R-MARCA-CERRADA` | an item `descripcion`/`marca` names a closed brand (Mac/Apple/Intel i7 "o superior" style brand-lock) without "o equivalente" | MEDIUM | COHERENCE | yes |
| `R-EXPERIENCIA-RESTRICTIVA` | experience requires ≥N units AND a second specific implementation jointly (limits plural bidders) | MEDIUM | COHERENCE | yes |
| `R-FECHAS-COHERENTES` | `fechaCierre <= fechaPublicacion`, or `plazoEjecucion` parses to ≤0 / > 1800 days | MEDIUM | FORMAT | no |
| `R-MODALIDAD-CUANTIA` | modality says "mínima cuantía" but `valorSinIva` exceeds the minimal-amount threshold | HIGH | COHERENCE | yes |

Finding shape:
```ts
interface Finding {
  id: string;
  ruleId: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
  category: "MISSING_FIELD" | "INCONSISTENCY" | "COHERENCE" | "FORMAT";
  message: string;                 // technical explanation (R6)
  evidence: string;                // textual evidence quoted from the document (R5/R6)
  location: { field?: string; page?: number; section?: string; line?: number; charStart?: number; charEnd?: number };
  riskAlert?: { level: "HIGH" | "MEDIUM" | "LOW"; reason: string };   // R12 early-warning
}
```

## Draft template shape (FTN/FTP/Carta)

`DraftDocument = { documentId, version, format: "markdown", sections: DraftSection[], content: string }` where `DraftSection = { id, title, fields: { label, value, editable: true, placeholder?: "[[COMPLETAR: ...]]", flaggedByFindingId?: string }[] }`. Missing fields render `[[COMPLETAR: <label>]]`; fields touched by a finding carry a `⚠` marker and the finding id. `content` is the full Markdown rendering for display/download.

## REST API (local server mirrors API Gateway design; NO auth — MVP gap)

- `POST /documents/upload` — body `{ filename: string, text?: string, contentBase64?: string, metadata?: { entidad?, procesoId? } }` → **201** `{ documentId, status, extracted, findings, alerts }` (full pipeline runs synchronously in local mode).
- `GET /documents/:id` → **200** `{ documentId, status, extracted, findings, alerts, versions, decisions }` / **404**.
- `GET /documents/:id/draft` (`?download=1` → `Content-Disposition: attachment`) → **200** `{ documentId, version, format, content }`.
- `POST /documents/:id/decision` — body `{ findingId, action: "ACCEPT"|"REJECT", justification: string }` (justification required when REJECT) → **200** `{ decisionId, recordedAt }` / **400** / **404**.
- `GET /search?q=...` → **200** `{ query, results: [{ documentId, findingId, score, snippet, location }] }`.

All inputs validated with zod at the boundary; all I/O wrapped so there are no silent failures; no PII in logs; no hardcoded secrets.

## Ordered implementation items

- [ ] 1. **Project scaffold + domain types + interfaces + config.**
      Create `package.json` (type: module; scripts: `dev`, `start`, `build`, `typecheck`, `test`, `seed`), `tsconfig.json` (strict, `noEmit`, bundler resolution), `.env.example` (`AIDLC_PROVIDER=local`, AWS placeholders). Add domain types and the 7 service interfaces.
      Files: `c:\Users\jparrap\AgilIA-AWS\package.json`, `c:\Users\jparrap\AgilIA-AWS\tsconfig.json`, `c:\Users\jparrap\AgilIA-AWS\.env.example`, `c:\Users\jparrap\AgilIA-AWS\src\domain\types.ts`, `c:\Users\jparrap\AgilIA-AWS\src\providers\interfaces.ts`, `c:\Users\jparrap\AgilIA-AWS\src\config.ts`
      Verify: `bun install` then `bunx tsc --noEmit` — no type errors.

- [ ] 2. **Local infra providers: Storage, TraceStore, SearchIndex, DocumentExtractor.**
      Filesystem-backed Storage (`.data/` under root) + in-memory index; TraceStore records documents/decisions/versions; SearchIndex is a BM25-ish lexical index over findings; DocumentExtractor parses plain text (and PDF-as-text best effort) into `ExtractedData` with locations.
      Files: `src\providers\local\local-storage.ts`, `src\providers\local\local-trace-store.ts`, `src\providers\local\local-search-index.ts`, `src\providers\local\local-document-extractor.ts`, `src\rules\field-extraction.ts`, `tests\providers\local-providers.test.ts`
      Verify: `bun test tests/providers` — passes (extractor pulls known fields from the sample; search returns ranked hits).

- [ ] 3. **Local intelligence: NlpAnalyzer + RuleValidator + risk alerts + DraftGenerator.**
      NlpAnalyzer extracts entities/key-phrases deterministically; RuleValidator implements the 7 rules above producing findings with location+evidence+explanation and HIGH→riskAlert; DraftGenerator builds the FTN/FTP/Carta structured+Markdown draft with placeholders and finding markers.
      Files: `src\providers\local\local-nlp-analyzer.ts`, `src\rules\rule-definitions.ts`, `src\providers\local\local-rule-validator.ts`, `src\providers\local\local-draft-generator.ts`, `tests\rules\rule-validator.test.ts`, `tests\draft\draft-generator.test.ts`
      Verify: `bun test tests/rules tests/draft` — passes. Rule tests cover happy path + edges: (a) budget > CDP alert, (b) sin-IVA/con-IVA value inconsistency, (c) closed-brand item, (d) missing mandatory `objeto`, (e) inverted dates. Draft tests cover: happy full draft, missing-field placeholder emitted, finding marker present.

- [ ] 4. **Pipeline orchestrator + provider selector.**
      `runPipeline(input)` = extract → analyze → validate → alerts → draft → persist (Storage+TraceStore+SearchIndex). Selector returns the local bundle, or dynamically imports the aws bundle when `AIDLC_PROVIDER=aws`.
      Files: `src\pipeline\pipeline.ts`, `src\providers\index.ts`, `tests\pipeline\pipeline.integration.test.ts`
      Verify: `bun test tests/pipeline` — integration test runs upload→draft end-to-end on the seeded sample and asserts findings, alerts, and a generated draft version exist.

- [ ] 5. **Local HTTP server (Hono) with the 5 REST endpoints.**
      `app.ts` builds the Hono app (exported for tests); `routes.ts` wires handlers to the pipeline/providers; `schemas.ts` zod validation; `errors.ts` central error → status mapping; `index.ts` boots listener (reads `PORT`, default 8787). Log the no-auth warning on boot.
      Files: `src\server\app.ts`, `src\server\routes.ts`, `src\server\schemas.ts`, `src\server\errors.ts`, `src\server\index.ts`, `tests\server\server.integration.test.ts`
      Verify: `bun test tests/server` — in-process harness calls `app.fetch(...)` for every endpoint (upload, get, draft, decision happy+400, search) and asserts status/shape. No socket is opened; nothing blocks.

- [ ] 6. **Web SPA reusing product-final.html, wired to the local server.**
      Port the 4-screen look/content from `product-final.html` into `web/index.html`; `web/app.js` calls the local API (upload sample → render extracted+findings+alerts → view/download draft → POST decision). Relax the mock CSP to allow `connect-src` to the local server.
      Files: `web\index.html`, `web\app.js`
      Verify: `bunx tsc --noEmit` still clean; manual note in README. (Automated coverage stays in the server/pipeline tests; the SPA is static assets served by the Hono app.)

- [ ] 7. **Sample procurement documents.**
      Two realistic plain-text estudios previos mirroring the PGN AGL-2026-PGN41 case: one clean-ish, one seeded with the value-inconsistency + closed-brand + restrictive-experience defects so the demo surfaces findings immediately.
      Files: `samples\estudio_previo_pgn_limpio.txt`, `samples\estudio_previo_pgn_inconsistencias.txt`
      Verify: reused by item 4's integration test (the inconsistencies sample must yield ≥3 findings incl. ≥1 HIGH alert).

- [ ] 8. **AWS thin provider bundle (must compile).**
      Thin implementations wired to the AWS SDK (`@aws-sdk/client-s3`, `-dynamodb`, `-textract`, `-comprehend`, `-bedrock-runtime`, plus OpenSearch client) selected by `AIDLC_PROVIDER=aws`. Methods construct clients and call the services; response mapping may be minimal but the bundle typechecks. Clear `// FUTURE WIRING` markers.
      Files: `src\providers\aws\aws-storage.ts`, `src\providers\aws\aws-trace-store.ts`, `src\providers\aws\aws-search-index.ts`, `src\providers\aws\aws-document-extractor.ts`, `src\providers\aws\aws-nlp-analyzer.ts`, `src\providers\aws\aws-rule-validator.ts`, `src\providers\aws\aws-draft-generator.ts`, `src\providers\aws\index.ts`
      Verify: `bunx tsc --noEmit` — whole project (local + aws) typechecks.

- [ ] 9. **Extend iac/template.yaml (do NOT rewrite).**
      Add the missing read paths and wiring the brief calls out: `GET /documents/{id}` + `GET /documents/{id}/draft` (new `DraftRetrieverFunction`), `GET /search` (`search` resource + `SearchHandlerFunction`), their Cognito-authorized methods, API-invoke permissions, and add the new methods to `ApiGatewayDeployment.DependsOn`. Fix the broken event chain (Textract emits `ExtractionStarted` while `TextExtractedRule` matches `TextExtracted`). Keep SSE/KMS encryption, least-privilege IAM, no PII in logs.
      Files: `c:\Users\jparrap\AgilIA-AWS\iac\template.yaml`
      Verify: `bunx --yes cfn-lint iac/template.yaml` if available; otherwise `bun -e "import('yaml').then(...)"` YAML parse + grep that the new logical ids resolve. Document the exact check in README.

- [ ] 10. **README.**
      What AgilIA is (1 paragraph), local-vs-aws provider model, install/build/test (`bun install`, `bunx tsc --noEmit`, `bun test`), run the demo (`bun run dev`, open `web/index.html` against `http://localhost:8787`), seeded sample flow, and known MVP gaps (no local auth = Cognito is the prod boundary; thin aws provider; R13/R15/R16/R17 operational/deferred; R-coverage table).
      Files: `c:\Users\jparrap\AgilIA-AWS\README.md`
      Verify: `bun install && bunx tsc --noEmit && bun test` all green from a clean checkout following only the README.

## Requirements coverage

R1 extract (item 2), R2 guidance/placeholders (item 3), R3 editable draft (item 3/6), R4 user control/versions (items 2,5), R5 location (items 2,3), R6 evidence+explanation (item 3), R7 decisions (items 2,5), R8 version history (items 2,4), R11 coherence (item 3), R12 risk alerts (item 3). R9 auth deferred (local no-auth gap), R10 rules source (local rule-definitions stands in for Secrets Manager), R13/R15/R16/R17 operational — deferred, documented in README.
