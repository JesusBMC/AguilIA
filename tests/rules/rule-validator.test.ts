/**
 * FEAT-002 rule-engine tests.
 *
 * Happy path: the clean sample yields no HIGH-severity risk alerts.
 * Edges (each asserting a specific ruleId / severity / evidence):
 *   (a) valorSinIva > cdpValor  -> R-PRESUPUESTO-CDP, HIGH, risk alert
 *   (b) sin-IVA / con-IVA mismatch -> R-VALOR-INCONSISTENTE, HIGH
 *   (c) closed-brand item -> R-MARCA-CERRADA
 *   (d) missing mandatory `objeto` -> R-CAMPO-OBLIGATORIO, HIGH
 *   (e) fechaCierre <= fechaPublicacion -> R-FECHAS-COHERENTES
 */

import { describe, expect, test } from "bun:test";
import { LocalRuleValidator } from "../../src/providers/local/local-rule-validator.ts";
import { extractFields } from "../../src/rules/field-extraction.ts";
import type { ExtractedData, Finding } from "../../src/domain/types.ts";

const validator = new LocalRuleValidator();

function located<T>(value: T, field: string, evidence = ""): {
  value: T;
  location: { field: string };
  evidence: string;
} {
  return { value, location: { field }, evidence };
}

/** Minimal consistent base so individual edges toggle a single rule. */
function baseData(): ExtractedData {
  return {
    entidad: located("Procuraduria General de la Nacion", "entidad"),
    objeto: located("Adquisicion de bienes tecnologicos", "objeto"),
    modalidad: located("Seleccion abreviada", "modalidad"),
    valorSinIva: located(51_460_675_487, "valorSinIva", "$51.460.675.487"),
    valorTotalConIva: located(61_587_261_594, "valorTotalConIva", "$61.587.261.594"),
    cdpNumero: located("40626", "cdpNumero"),
    cdpValor: located(51_460_675_487, "cdpValor", "$51.460.675.487"),
    fechaPublicacion: located("2026-06-10", "fechaPublicacion"),
    fechaCierre: located("2026-06-20", "fechaCierre"),
    plazoEjecucion: { ...located("180 dias", "plazoEjecucion"), dias: 180 },
    items: [],
    experienciaExigida: located(
      "Suministro de bienes tecnologicos en los ultimos cinco anos",
      "experienciaExigida",
    ),
    garantias: located("Cumplimiento 20%", "garantias"),
  };
}

function byRule(findings: Finding[], ruleId: string): Finding[] {
  return findings.filter((f) => f.ruleId === ruleId);
}

const CLEAN_SAMPLE = `Entidad: Procuraduria General de la Nacion
Proceso: AGL-2026-PGN41
Objeto: Adquisicion de bienes tecnologicos para la PGN
Modalidad de seleccion: Seleccion abreviada - Bolsa de Productos
Valor total sin IVA: $51.460.675.487
Valor total con IVA y costos: $61.587.261.594
CDP No. 40626 por valor de $51.460.675.487
Fecha de publicacion: 10/06/2026
Fecha de cierre: 20/06/2026
Plazo de ejecucion: 180 dias
Experiencia exigida: Suministro de bienes tecnologicos en los ultimos cinco anos
Garantias: Cumplimiento 20%
Items:
1. Computador todo en uno, o equivalente - Cantidad: 3500 - Marca: Abierta (o equivalente)
`;

describe("LocalRuleValidator — happy path", () => {
  test("clean sample produces no HIGH-severity findings or alerts", async () => {
    const findings = await validator.validate(extractFields(CLEAN_SAMPLE));
    const high = findings.filter((f) => f.severity === "HIGH");
    expect(high).toHaveLength(0);
    const highAlerts = findings.filter((f) => f.riskAlert?.level === "HIGH");
    expect(highAlerts).toHaveLength(0);
  });
});

describe("LocalRuleValidator — edge cases", () => {
  test("(a) valorSinIva > cdpValor emits R-PRESUPUESTO-CDP HIGH with alert", async () => {
    const data = baseData();
    data.cdpValor = located(10_000_000_000, "cdpValor", "$10.000.000.000");
    const findings = await validator.validate(data);
    const hits = byRule(findings, "R-PRESUPUESTO-CDP");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.severity).toBe("HIGH");
    expect(hits[0]?.riskAlert?.level).toBe("HIGH");
    expect(hits[0]?.evidence.length).toBeGreaterThan(0);
  });

  test("(b) sin-IVA / con-IVA mismatch emits R-VALOR-INCONSISTENTE HIGH", async () => {
    const data = baseData();
    // CDP backs the con-IVA figure while the budget is declared sin IVA.
    data.cdpValor = located(61_587_261_594, "cdpValor", "$61.587.261.594");
    const findings = await validator.validate(data);
    const hits = byRule(findings, "R-VALOR-INCONSISTENTE");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.severity).toBe("HIGH");
    expect(hits[0]?.evidence).toContain("51.460.675.487");
    expect(hits[0]?.evidence).toContain("61.587.261.594");
  });

  test("(c) closed-brand item without 'o equivalente' emits R-MARCA-CERRADA", async () => {
    const data = baseData();
    data.items = [
      {
        numero: located(3, "items"),
        descripcion: located("Estacion de trabajo Mac Studio M3 Ultra", "items", "3. Estacion Mac Studio"),
        marca: located("Apple", "items", "Marca: Apple"),
      },
    ];
    const findings = await validator.validate(data);
    const hits = byRule(findings, "R-MARCA-CERRADA");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.severity).toBe("MEDIUM");
    expect(hits[0]?.id).toBe("R-MARCA-CERRADA:item-3");
  });

  test("closed-brand item WITH 'o equivalente' does not fire", async () => {
    const data = baseData();
    data.items = [
      {
        numero: located(3, "items"),
        descripcion: located("Estacion tipo Mac Studio o equivalente", "items"),
        marca: located("Apple o equivalente", "items"),
      },
    ];
    const findings = await validator.validate(data);
    expect(byRule(findings, "R-MARCA-CERRADA")).toHaveLength(0);
  });

  test("(d) missing mandatory objeto emits R-CAMPO-OBLIGATORIO HIGH", async () => {
    const data = baseData();
    delete data.objeto;
    const findings = await validator.validate(data);
    const hits = byRule(findings, "R-CAMPO-OBLIGATORIO").filter(
      (f) => f.location.field === "objeto",
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]?.severity).toBe("HIGH");
    expect(hits[0]?.riskAlert?.level).toBe("HIGH");
  });

  test("(e) fechaCierre <= fechaPublicacion emits R-FECHAS-COHERENTES", async () => {
    const data = baseData();
    data.fechaPublicacion = located("2026-06-20", "fechaPublicacion");
    data.fechaCierre = located("2026-06-10", "fechaCierre");
    const findings = await validator.validate(data);
    const hits = byRule(findings, "R-FECHAS-COHERENTES").filter(
      (f) => f.id === "R-FECHAS-COHERENTES:orden",
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]?.severity).toBe("MEDIUM");
    expect(hits[0]?.riskAlert).toBeUndefined();
  });

  test("validate throws on non-object input (no silent failure)", async () => {
    // @ts-expect-error intentionally wrong type to prove the guard fires
    await expect(validator.validate(null)).rejects.toThrow();
  });
});
