/**
 * Local {@link DraftGenerator}.
 *
 * Builds the three editable drafts a negotiation needs — Ficha Técnica de
 * Negociación (FTN), Ficha Técnica de Producto (FTP) and Carta de intención —
 * as structured {@link DraftSection}s plus a full Markdown rendering.
 *
 * Behaviour:
 *  - fields are filled from {@link ExtractedData};
 *  - a missing source value renders `[[COMPLETAR: <label>]]`;
 *  - a field touched by a {@link Finding} is marked with the finding id and a
 *    visible ⚠ warning;
 *  - recorded {@link Decision}s are applied: a REJECT dismisses the flag, an
 *    ACCEPT keeps it and notes that the observation was accepted.
 *
 * The returned {@link DraftDocument} carries a placeholder `documentId` and
 * `version` 1; the pipeline overrides `documentId`/`version` when it persists
 * the draft as a document version.
 */

import type {
  Decision,
  DraftDocument,
  DraftField,
  DraftSection,
  ExtractedData,
  Finding,
  Located,
} from "../../domain/types.ts";
import type { DraftGenerator } from "../interfaces.ts";
import { formatCOP } from "../../rules/rule-definitions.ts";

/** Internal field blueprint: how to resolve, label and flag one draft field. */
interface FieldBlueprint {
  label: string;
  /** Domain field key used to match findings by `location.field`. */
  fieldKey: string;
  /** Resolved display value, or undefined when the source data is missing. */
  value: string | undefined;
  /** For item fields: the item number used to disambiguate findings. */
  itemNumber?: number;
}

function text(located: Located<string> | undefined): string | undefined {
  return located?.value;
}

function money(located: Located<number> | undefined): string | undefined {
  return located ? formatCOP(located.value) : undefined;
}

export class LocalDraftGenerator implements DraftGenerator {
  async generate(
    extracted: ExtractedData,
    findings: Finding[],
    decisions: Decision[],
  ): Promise<DraftDocument> {
    if (!extracted || typeof extracted !== "object") {
      throw new Error("LocalDraftGenerator.generate: extracted data is required");
    }
    const safeFindings = Array.isArray(findings) ? findings : [];
    const safeDecisions = Array.isArray(decisions) ? decisions : [];

    const decisionByFinding = new Map<string, Decision>();
    for (const decision of safeDecisions) {
      decisionByFinding.set(decision.findingId, decision);
    }

    const sections: DraftSection[] = [
      this.buildSection(
        "ftn",
        "Ficha Técnica de Negociación (FTN)",
        this.ftnFields(extracted),
        safeFindings,
        decisionByFinding,
      ),
      this.buildSection(
        "ftp",
        "Ficha Técnica de Producto (FTP)",
        this.ftpFields(extracted),
        safeFindings,
        decisionByFinding,
      ),
      this.buildSection(
        "carta",
        "Carta de intención",
        this.cartaFields(extracted),
        safeFindings,
        decisionByFinding,
      ),
    ];

    const content = this.renderMarkdown(sections, safeFindings, decisionByFinding);

    return {
      documentId: "",
      version: 1,
      format: "markdown",
      sections,
      content,
    };
  }

  private ftnFields(e: ExtractedData): FieldBlueprint[] {
    return [
      { label: "Entidad contratante", fieldKey: "entidad", value: text(e.entidad) },
      { label: "Objeto de la negociación", fieldKey: "objeto", value: text(e.objeto) },
      { label: "Modalidad de puja", fieldKey: "modalidad", value: text(e.modalidad) },
      {
        label: "Valor máximo (sin IVA)",
        fieldKey: "valorSinIva",
        value: money(e.valorSinIva),
      },
      {
        label: "Plazo de ejecución",
        fieldKey: "plazoEjecucion",
        value: text(e.plazoEjecucion),
      },
    ];
  }

  private ftpFields(e: ExtractedData): FieldBlueprint[] {
    if (e.items.length === 0) {
      return [
        {
          label: "Ítems / bienes",
          fieldKey: "items",
          value: undefined,
        },
      ];
    }
    return e.items.map((item, index) => {
      const numero = item.numero?.value ?? index + 1;
      const parts = [item.descripcion?.value?.trim()].filter(Boolean) as string[];
      if (item.cantidad) parts.push(`Cantidad: ${item.cantidad.value}`);
      if (item.marca) parts.push(`Marca: ${item.marca.value}`);
      return {
        label: `Ítem ${numero}`,
        fieldKey: "items",
        value: parts.length > 0 ? parts.join(" · ") : undefined,
        itemNumber: numero,
      };
    });
  }

  private cartaFields(e: ExtractedData): FieldBlueprint[] {
    return [
      { label: "Entidad contratante", fieldKey: "entidad", value: text(e.entidad) },
      { label: "Objeto", fieldKey: "objeto", value: text(e.objeto) },
      {
        label: "Valor total (con IVA y costos)",
        fieldKey: "valorTotalConIva",
        value: money(e.valorTotalConIva),
      },
      {
        label: "Experiencia exigida",
        fieldKey: "experienciaExigida",
        value: text(e.experienciaExigida),
      },
      { label: "Fecha de cierre", fieldKey: "fechaCierre", value: text(e.fechaCierre) },
    ];
  }

  /** Find the finding (if any) that flags a given field blueprint. */
  private findingFor(
    blueprint: FieldBlueprint,
    findings: Finding[],
  ): Finding | undefined {
    const candidates = findings.filter(
      (f) => f.location.field === blueprint.fieldKey,
    );
    if (candidates.length === 0) return undefined;
    if (blueprint.fieldKey === "items" && blueprint.itemNumber !== undefined) {
      return (
        candidates.find((f) => f.id.endsWith(`item-${blueprint.itemNumber}`)) ??
        undefined
      );
    }
    return candidates[0];
  }

  private buildSection(
    id: string,
    title: string,
    blueprints: FieldBlueprint[],
    findings: Finding[],
    decisionByFinding: Map<string, Decision>,
  ): DraftSection {
    const fields: DraftField[] = blueprints.map((bp) => {
      const field: DraftField = {
        label: bp.label,
        value: bp.value ?? "",
        editable: true,
      };
      if (bp.value === undefined) {
        field.placeholder = `[[COMPLETAR: ${bp.label}]]`;
      }

      const finding = this.findingFor(bp, findings);
      if (finding) {
        const decision = decisionByFinding.get(finding.id);
        // A REJECT dismisses the observation; otherwise keep the flag.
        if (!decision || decision.action === "ACCEPT") {
          field.flaggedByFindingId = finding.id;
        }
      }
      return field;
    });

    return { id, title, fields };
  }

  private renderMarkdown(
    sections: DraftSection[],
    findings: Finding[],
    decisionByFinding: Map<string, Decision>,
  ): string {
    const findingById = new Map(findings.map((f) => [f.id, f]));
    const lines: string[] = [];
    lines.push("# Borrador editable de documentos de negociación");
    lines.push("");
    lines.push(
      "> Documento generado automáticamente por AgilIA. Todos los campos son editables.",
    );
    lines.push("");

    for (const section of sections) {
      lines.push(`## ${section.title}`);
      lines.push("");
      for (const field of section.fields) {
        const display =
          field.value && field.value.length > 0
            ? field.value
            : (field.placeholder ?? "[[COMPLETAR]]");
        let line = `- **${field.label}:** ${display}`;
        if (field.flaggedByFindingId) {
          const finding = findingById.get(field.flaggedByFindingId);
          const decision = decisionByFinding.get(field.flaggedByFindingId);
          const note = decision?.action === "ACCEPT" ? " (observación aceptada)" : "";
          line += `  \n  ⚠ **[${field.flaggedByFindingId}]** ${finding?.message ?? "Revisar este campo."}${note}`;
        }
        lines.push(line);
      }
      lines.push("");
    }

    return lines.join("\n");
  }
}
