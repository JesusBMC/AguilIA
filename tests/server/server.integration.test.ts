/**
 * In-process integration tests for the Hono server.
 *
 * Every endpoint is exercised through `app.fetch(new Request(...))` — no socket
 * is ever opened and nothing blocks, which is the only safe way to verify an
 * HTTP server on Windows PowerShell. The app is built with an isolated provider
 * bundle (temp dirs under <root>/.data) so runs are deterministic and leave no
 * shared state behind; the temp dir is removed in afterAll.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { Hono } from "hono";
import { buildApp } from "../../src/server/app.ts";
import type { ProviderBundle } from "../../src/providers/interfaces.ts";
import { LocalStorage } from "../../src/providers/local/local-storage.ts";
import { LocalTraceStore } from "../../src/providers/local/local-trace-store.ts";
import { LocalSearchIndex } from "../../src/providers/local/local-search-index.ts";
import { LocalDocumentExtractor } from "../../src/providers/local/local-document-extractor.ts";
import { LocalNlpAnalyzer } from "../../src/providers/local/local-nlp-analyzer.ts";
import { LocalRuleValidator } from "../../src/providers/local/local-rule-validator.ts";
import { LocalDraftGenerator } from "../../src/providers/local/local-draft-generator.ts";

// Workspace-local temp dir (never os.tmpdir() — EPERM on this machine).
const TEST_DIR = resolve(".data", `test-feat003-${randomUUID()}`);

const SAMPLE = [
  "ESTUDIO PREVIO",
  "Entidad: Procuraduria General de la Nacion",
  "Proceso: AGL-2026-PGN41",
  "Objeto: Adquisicion, implementacion y soporte tecnologico para la PGN",
  "Modalidad de seleccion: Seleccion abreviada - Bolsa de Productos (BMC)",
  "Valor total sin IVA: $51.460.675.487",
  "Valor total con IVA y costos: $61.587.261.594",
  "CDP No. 40626 por valor de $61.587.261.594",
  "Fecha de publicacion: 10/06/2026",
  "Fecha de cierre: 20/06/2026",
  "Plazo de ejecucion: 180 dias",
  "Experiencia exigida: Suministro de minimo 500 equipos mas la implementacion de una plataforma de audiencias virtuales.",
  "Items / bienes a adquirir:",
  "3. Estacion de trabajo Mac Studio M3 Ultra - Cantidad: 5 - Marca: Apple",
].join("\n");

function buildIsolatedProviders(): ProviderBundle {
  return {
    documentExtractor: new LocalDocumentExtractor(),
    nlpAnalyzer: new LocalNlpAnalyzer(),
    ruleValidator: new LocalRuleValidator(),
    draftGenerator: new LocalDraftGenerator(),
    storage: new LocalStorage(join(TEST_DIR, "blobs")),
    traceStore: new LocalTraceStore(join(TEST_DIR, "trace")),
    searchIndex: new LocalSearchIndex(),
  };
}

let app: Hono;

async function get(path: string): Promise<Response> {
  return await app.fetch(new Request(`http://local.test${path}`));
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return await app.fetch(
    new Request(`http://local.test${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeAll(() => {
  app = buildApp({ providers: buildIsolatedProviders() });
});

afterAll(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("AgilIA HTTP server (in-process)", () => {
  let documentId = "";
  let findingId = "";

  test("POST /documents/upload returns 201 with findings and alerts", async () => {
    const res = await postJson("/documents/upload", {
      filename: "estudio.txt",
      text: SAMPLE,
      metadata: { entidad: "PGN" },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      documentId: string;
      status: string;
      extracted: unknown;
      findings: Array<{ id: string; ruleId: string }>;
      alerts: unknown[];
    };
    expect(typeof body.documentId).toBe("string");
    expect(body.documentId.length).toBeGreaterThan(0);
    expect(body.status).toBe("DRAFTED");
    expect(body.extracted).toBeDefined();
    expect(Array.isArray(body.findings)).toBe(true);
    expect(body.findings.length).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(body.alerts)).toBe(true);

    documentId = body.documentId;
    findingId = body.findings[0]!.id;
  });

  test("POST /documents/upload rejects a missing filename with 400", async () => {
    const res = await postJson("/documents/upload", { text: SAMPLE });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION");
  });

  test("POST /documents/upload rejects a non-JSON body with 400", async () => {
    const res = await app.fetch(
      new Request("http://local.test/documents/upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not json",
      }),
    );
    expect(res.status).toBe(400);
  });

  test("GET /documents/:id returns 200 with the full record", async () => {
    const res = await get(`/documents/${documentId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      documentId: string;
      findings: unknown[];
      versions: unknown[];
      decisions: unknown[];
    };
    expect(body.documentId).toBe(documentId);
    expect(Array.isArray(body.findings)).toBe(true);
    expect(Array.isArray(body.versions)).toBe(true);
    expect(body.versions.length).toBeGreaterThanOrEqual(1);
  });

  test("GET /documents/:id returns 404 for an unknown id", async () => {
    const res = await get("/documents/does-not-exist");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });

  test("GET /documents/:id/draft returns 200 with markdown content", async () => {
    const res = await get(`/documents/${documentId}/draft`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      documentId: string;
      version: number;
      format: string;
      content: string;
    };
    expect(body.documentId).toBe(documentId);
    expect(body.format).toBe("markdown");
    expect(body.version).toBeGreaterThanOrEqual(1);
    expect(body.content).toContain("Ficha Técnica de Negociación");
  });

  test("GET /documents/:id/draft?download=1 sets a Content-Disposition attachment", async () => {
    const res = await get(`/documents/${documentId}/draft?download=1`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("attachment");
  });

  test("POST /documents/:id/decision records an ACCEPT decision (200)", async () => {
    const res = await postJson(`/documents/${documentId}/decision`, {
      findingId,
      action: "ACCEPT",
      justification: "Se mantiene la observación.",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      decisionId: string;
      recordedAt: string;
    };
    expect(typeof body.decisionId).toBe("string");
    expect(body.decisionId.length).toBeGreaterThan(0);
    expect(typeof body.recordedAt).toBe("string");
  });

  test("POST /documents/:id/decision rejects REJECT without justification (400)", async () => {
    const res = await postJson(`/documents/${documentId}/decision`, {
      findingId,
      action: "REJECT",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION");
  });

  test("POST /documents/:id/decision returns 404 for an unknown document", async () => {
    const res = await postJson("/documents/unknown-doc/decision", {
      findingId: "x",
      action: "ACCEPT",
    });
    expect(res.status).toBe(404);
  });

  test("GET /search returns 200 with ranked results", async () => {
    // Use a term that appears in the rule findings (e.g. marca / valor).
    const res = await get("/search?q=valor");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      query: string;
      results: Array<{ documentId: string; findingId: string; score: number }>;
    };
    expect(body.query).toBe("valor");
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results.length).toBeGreaterThanOrEqual(1);
    expect(body.results[0]!.documentId).toBe(documentId);
  });

  test("GET /search rejects an empty query with 400", async () => {
    const res = await get("/search?q=");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION");
  });
});
