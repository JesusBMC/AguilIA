/**
 * FEAT-002 draft-generator tests.
 *
 * Happy path: produces FTN + FTP + Carta sections with non-empty Markdown.
 * Edge (missing field): a `[[COMPLETAR: ...]]` placeholder is emitted.
 * Edge (finding on a field): that field carries the finding id.
 * Edge (decision): a REJECT decision dismisses the flag.
 */

import { describe, expect, test } from "bun:test";
import { LocalDraftGenerator } from "../../src/providers/local/local-draft-generator.ts";
import type {
  Decision,
  DraftSection,
  ExtractedData,
  Finding,
} from "../../src/domain/types.ts";

const generator = new LocalDraftGenerator();

function located<T>(value: T, field: string): {
  value: T;
  location: { field: string };
} {
  return { value, location: { field } };
}

function fullData(): ExtractedData {
  return {
    entidad: located("Procuraduria General de la Nacion", "entidad"),
    objeto: located("Adquisicion de bienes tecnologicos", "objeto"),
    modalidad: located("Seleccion abreviada", "modalidad"),
    valorSinIva: located(51_460_675_487, "valorSinIva"),
    valorTotalConIva: located(61_587_261_594, "valorTotalConIva"),
    cdpNumero: located("40626", "cdpNumero"),
    cdpValor: located(51_460_675_487, "cdpValor"),
    fechaPublicacion: located("2026-06-10", "fechaPublicacion"),
    fechaCierre: located("2026-06-20", "fechaCierre"),
    plazoEjecucion: { ...located("180 dias", "plazoEjecucion"), dias: 180 },
    items: [
      {
        numero: located(1, "items"),
        descripcion: located("Computador todo en uno", "items"),
        cantidad: located(3500, "items"),
      },
    ],
    experienciaExigida: located("Suministro en los ultimos cinco anos", "experienciaExigida"),
    garantias: located("Cumplimiento 20%", "garantias"),
  };
}

function sectionById(sections: DraftSection[], id: string): DraftSection {
  const found = sections.find((s) => s.id === id);
  if (!found) throw new Error(`section "${id}" missing`);
  return found;
}

describe("LocalDraftGenerator", () => {
  test("happy path builds FTN + FTP + Carta with non-empty Markdown", async () => {
    const draft = await generator.generate(fullData(), [], []);
    expect(draft.format).toBe("markdown");
    expect(draft.sections.map((s) => s.id).sort()).toEqual(["carta", "ftn", "ftp"]);
    expect(draft.content.length).toBeGreaterThan(0);
    expect(draft.content).toContain("Ficha Técnica de Negociación");
    expect(draft.content).toContain("Carta de intención");

    const ftn = sectionById(draft.sections, "ftn");
    const valor = ftn.fields.find((f) => f.label.includes("Valor máximo"));
    expect(valor?.value).toContain("51.460.675.487");
  });

  test("missing field emits a [[COMPLETAR: ...]] placeholder", async () => {
    const data = fullData();
    delete data.modalidad;
    const draft = await generator.generate(data, [], []);
    const ftn = sectionById(draft.sections, "ftn");
    const modalidad = ftn.fields.find((f) => f.label.includes("Modalidad"));
    expect(modalidad?.value).toBe("");
    expect(modalidad?.placeholder).toBe("[[COMPLETAR: Modalidad de puja]]");
    expect(draft.content).toContain("[[COMPLETAR: Modalidad de puja]]");
  });

  test("a finding on a field flags that field with the finding id", async () => {
    const findings: Finding[] = [
      {
        id: "R-MARCA-CERRADA:item-1",
        ruleId: "R-MARCA-CERRADA",
        severity: "MEDIUM",
        category: "COHERENCE",
        message: "El item 1 especifica una marca cerrada",
        evidence: "Mac Studio",
        location: { field: "items" },
      },
    ];
    const draft = await generator.generate(fullData(), findings, []);
    const ftp = sectionById(draft.sections, "ftp");
    const item = ftp.fields.find((f) => f.label === "Ítem 1");
    expect(item?.flaggedByFindingId).toBe("R-MARCA-CERRADA:item-1");
    expect(draft.content).toContain("R-MARCA-CERRADA:item-1");
  });

  test("a REJECT decision dismisses the flag on a field", async () => {
    const findings: Finding[] = [
      {
        id: "R-MARCA-CERRADA:item-1",
        ruleId: "R-MARCA-CERRADA",
        severity: "MEDIUM",
        category: "COHERENCE",
        message: "El item 1 especifica una marca cerrada",
        evidence: "Mac Studio",
        location: { field: "items" },
      },
    ];
    const decisions: Decision[] = [
      {
        id: "d1",
        findingId: "R-MARCA-CERRADA:item-1",
        action: "REJECT",
        justification: "La especificacion es justificada tecnicamente",
        recordedAt: new Date().toISOString(),
      },
    ];
    const draft = await generator.generate(fullData(), findings, decisions);
    const ftp = sectionById(draft.sections, "ftp");
    const item = ftp.fields.find((f) => f.label === "Ítem 1");
    expect(item?.flaggedByFindingId).toBeUndefined();
  });

  test("throws when extracted data is missing (no silent failure)", async () => {
    // @ts-expect-error intentionally wrong type to prove the guard fires
    await expect(generator.generate(undefined, [], [])).rejects.toThrow();
  });
});
