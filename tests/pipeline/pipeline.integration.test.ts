/**
 * FEAT-002 pipeline integration test.
 *
 * Reads the seeded inconsistencias sample, runs the full pipeline against a
 * fresh local provider bundle, and asserts the end-to-end outcome:
 *   - >= 3 findings including >= 1 HIGH-severity risk alert,
 *   - a draft version is recorded in the TraceStore,
 *   - the SearchIndex returns a hit for a term drawn from a finding.
 *
 * Runtime state is written under a workspace-local `.data/` dir (the OS temp
 * dir throws EPERM on this host) and cleaned up afterwards.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import { join, resolve } from "node:path";

import { runPipeline } from "../../src/pipeline/pipeline.ts";
import type { ProviderBundle } from "../../src/providers/interfaces.ts";
import { LocalDocumentExtractor } from "../../src/providers/local/local-document-extractor.ts";
import { LocalNlpAnalyzer } from "../../src/providers/local/local-nlp-analyzer.ts";
import { LocalRuleValidator } from "../../src/providers/local/local-rule-validator.ts";
import { LocalDraftGenerator } from "../../src/providers/local/local-draft-generator.ts";
import { LocalStorage } from "../../src/providers/local/local-storage.ts";
import { LocalTraceStore } from "../../src/providers/local/local-trace-store.ts";
import { LocalSearchIndex } from "../../src/providers/local/local-search-index.ts";
import type { DocumentRecord } from "../../src/domain/types.ts";

const TEST_ROOT = join(process.cwd(), ".data", "test-pipeline");
const SAMPLE_PATH = resolve(
  process.cwd(),
  "samples",
  "estudio_previo_pgn_inconsistencias.txt",
);

function buildTestProviders(): { providers: ProviderBundle; search: LocalSearchIndex } {
  const search = new LocalSearchIndex();
  const providers: ProviderBundle = {
    documentExtractor: new LocalDocumentExtractor(),
    nlpAnalyzer: new LocalNlpAnalyzer(),
    ruleValidator: new LocalRuleValidator(),
    draftGenerator: new LocalDraftGenerator(),
    storage: new LocalStorage(join(TEST_ROOT, "blobs")),
    traceStore: new LocalTraceStore(join(TEST_ROOT, "trace")),
    searchIndex: search,
  };
  return { providers, search };
}

let record: DocumentRecord;
let search: LocalSearchIndex;

beforeAll(async () => {
  const text = await readFile(SAMPLE_PATH, "utf8");
  const built = buildTestProviders();
  search = built.search;
  record = await runPipeline(
    { filename: "estudio_previo_pgn_inconsistencias.txt", text },
    built.providers,
  );
});

afterAll(() => {
  try {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

describe("runPipeline — inconsistencias sample", () => {
  test("yields >= 3 findings including >= 1 HIGH risk alert", () => {
    expect(record.findings.length).toBeGreaterThanOrEqual(3);
    const highAlerts = record.alerts.filter((a) => a.level === "HIGH");
    expect(highAlerts.length).toBeGreaterThanOrEqual(1);
  });

  test("surfaces the seeded value, brand and experience defects", () => {
    const ruleIds = new Set(record.findings.map((f) => f.ruleId));
    expect(ruleIds.has("R-VALOR-INCONSISTENTE")).toBe(true);
    expect(ruleIds.has("R-MARCA-CERRADA")).toBe(true);
    expect(ruleIds.has("R-EXPERIENCIA-RESTRICTIVA")).toBe(true);
  });

  test("every finding carries location + evidence + explanation", () => {
    for (const finding of record.findings) {
      expect(finding.message.length).toBeGreaterThan(0);
      expect(finding.evidence.length).toBeGreaterThan(0);
      expect(finding.location).toBeDefined();
    }
  });

  test("a draft version is recorded in the TraceStore", () => {
    expect(record.status).toBe("DRAFTED");
    expect(record.versions.length).toBeGreaterThanOrEqual(1);
    expect(record.versions[0]?.storageKey).toContain("drafts/");
  });

  test("SearchIndex returns a hit for a term from a finding", async () => {
    const results = await search.search("marca cerrada");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.documentId).toBe(record.documentId);
  });

  test("a missing provider bundle fails loudly", async () => {
    // @ts-expect-error intentionally wrong type to prove the guard fires
    await expect(runPipeline({ filename: "x", text: "y" }, null)).rejects.toThrow();
  });
});
