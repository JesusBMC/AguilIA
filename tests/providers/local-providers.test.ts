/**
 * FEAT-001 verification tests for the local infrastructure providers.
 *
 * Covers (per acceptance criteria): extractor pulls known fields from a
 * representative sample (happy path); storage put->get round-trips and a
 * missing key returns null rather than throwing (edge); search ranks a
 * matching finding above a non-matching one and returns [] for an empty
 * index / non-matching query (edges).
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

import { LocalDocumentExtractor } from "../../src/providers/local/local-document-extractor.ts";
import { LocalStorage } from "../../src/providers/local/local-storage.ts";
import { LocalSearchIndex } from "../../src/providers/local/local-search-index.ts";
import {
  extractFields,
  parseColombianCurrency,
} from "../../src/rules/field-extraction.ts";
import type { Finding } from "../../src/domain/types.ts";

const SAMPLE_ESTUDIO = `ESTUDIO PREVIO
Entidad: Procuraduria General de la Nacion
Proceso: AGL-2026-PGN41
Objeto: Adquisicion, implementacion y soporte tecnologico para la PGN
Modalidad de seleccion: Seleccion abreviada - Bolsa de Productos (BMC)
Valor total sin IVA: $51.460.675.487
Valor total con IVA y costos: $61.587.261.594
CDP No. 40626 por valor de $61.587.261.594
Fecha de publicacion: 10/06/2026
Fecha de cierre: 20/06/2026
Plazo de ejecucion: 180 dias
Experiencia exigida: Suministro de minimo 500 equipos mas plataforma de audiencias
Garantias: Cumplimiento 20%, calidad 20%

Items:
1. Mac Studio M3 Ultra - Cantidad: 10 - Marca: Apple
2. MacBook Pro M5 - Cantidad: 20 - Marca: Apple
`;

// Use a workspace-local temp root: on this Windows host `readdir` on the OS
// temp dir can throw EPERM, and `.data/` is the real runtime location anyway.
const TEST_ROOT = join(process.cwd(), ".data", "test-providers");
const tmpDirs: string[] = [];
function makeTmpDir(): string {
  mkdirSync(TEST_ROOT, { recursive: true });
  const dir = mkdtempSync(join(TEST_ROOT, "case-"));
  tmpDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tmpDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup; ignore
    }
  }
});

describe("parseColombianCurrency", () => {
  test("parses dotted thousands into a number", () => {
    expect(parseColombianCurrency("$51.460.675.487")).toBe(51460675487);
  });

  test("parses a value with decimal comma", () => {
    expect(parseColombianCurrency("$ 1.234.567,89")).toBeCloseTo(1234567.89, 2);
  });

  test("returns undefined when no digits present", () => {
    expect(parseColombianCurrency("no amount")).toBeUndefined();
  });
});

describe("field-extraction / LocalDocumentExtractor", () => {
  test("extracts entidad, objeto, valorSinIva and cdp with locations", () => {
    const data = extractFields(SAMPLE_ESTUDIO);

    expect(data.entidad?.value).toContain("Procuraduria General");
    expect(data.objeto?.value).toContain("Adquisicion");
    expect(data.procesoId?.value).toBe("AGL-2026-PGN41");
    expect(data.valorSinIva?.value).toBe(51460675487);
    expect(data.valorTotalConIva?.value).toBe(61587261594);
    expect(data.cdpNumero?.value).toBe("40626");

    // Locations and evidence are populated.
    expect(typeof data.valorSinIva?.location.charStart).toBe("number");
    expect(data.valorSinIva?.location.charEnd).toBeGreaterThan(
      data.valorSinIva!.location.charStart!,
    );
    expect(data.objeto?.evidence?.length).toBeGreaterThan(0);

    // Plazo parses to a day count.
    expect(data.plazoEjecucion?.dias).toBe(180);

    // Items parsed with marca (feeds the closed-brand rule downstream).
    expect(data.items.length).toBe(2);
    expect(data.items[0]?.descripcion.value).toContain("Mac Studio");
    expect(data.items[0]?.marca?.value).toBe("Apple");
    expect(data.items[0]?.cantidad?.value).toBe(10);
  });

  test("missing anchors leave fields undefined and never throw", () => {
    const data = extractFields("Documento sin anclas reconocibles.");
    expect(data.entidad).toBeUndefined();
    expect(data.valorSinIva).toBeUndefined();
    expect(data.items).toEqual([]);
  });

  test("extractor decodes base64 content and delegates to field extraction", async () => {
    const extractor = new LocalDocumentExtractor();
    const base64 = Buffer.from(SAMPLE_ESTUDIO, "utf8").toString("base64");
    const data = await extractor.extract({
      filename: "estudio.txt",
      contentBase64: base64,
    });
    expect(data.entidad?.value).toContain("Procuraduria General");
  });

  test("extractor throws when no text or base64 is supplied", async () => {
    const extractor = new LocalDocumentExtractor();
    await expect(extractor.extract({ filename: "empty.txt" })).rejects.toThrow();
  });
});

describe("LocalStorage", () => {
  test("put then get round-trips the stored value", async () => {
    const storage = new LocalStorage(makeTmpDir());
    await storage.put("docs/alpha.json", '{"hello":"world"}');
    const value = await storage.get("docs/alpha.json");
    expect(value).toBe('{"hello":"world"}');
  });

  test("get on a missing key returns null (does not throw)", async () => {
    const storage = new LocalStorage(makeTmpDir());
    const value = await storage.get("does/not/exist.json");
    expect(value).toBeNull();
  });

  test("list returns stored keys filtered by prefix", async () => {
    const storage = new LocalStorage(makeTmpDir());
    await storage.put("a/one.txt", "1");
    await storage.put("a/two.txt", "2");
    await storage.put("b/three.txt", "3");
    const aKeys = await storage.list("a/");
    expect(aKeys.sort()).toEqual(["a/one.txt", "a/two.txt"]);
  });
});

describe("LocalSearchIndex", () => {
  const findings: Finding[] = [
    {
      id: "f-budget",
      ruleId: "R-PRESUPUESTO-CDP",
      severity: "HIGH",
      category: "COHERENCE",
      message: "El presupuesto sin IVA excede el valor del CDP disponible",
      evidence: "valor sin IVA 51460675487 mayor que CDP 40000000000",
      location: { field: "valorSinIva" },
    },
    {
      id: "f-brand",
      ruleId: "R-MARCA-CERRADA",
      severity: "MEDIUM",
      category: "COHERENCE",
      message: "El item menciona una marca cerrada sin o equivalente",
      evidence: "Mac Studio M3 Ultra marca Apple",
      location: { field: "items" },
    },
  ];

  test("ranks a matching finding above a non-matching one", async () => {
    const index = new LocalSearchIndex();
    await index.index(findings, "doc-1");
    const results = await index.search("presupuesto CDP");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.findingId).toBe("f-budget");
    expect(results[0]?.snippet.length).toBeGreaterThan(0);
    expect(results[0]?.location.field).toBe("valorSinIva");
  });

  test("returns [] for an empty index", async () => {
    const index = new LocalSearchIndex();
    const results = await index.search("cualquier cosa");
    expect(results).toEqual([]);
  });

  test("returns [] when no indexed term matches the query", async () => {
    const index = new LocalSearchIndex();
    await index.index(findings, "doc-1");
    const results = await index.search("zzzzz inexistente");
    expect(results).toEqual([]);
  });
});
