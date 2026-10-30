/**
 * The AgilIA business rule set.
 *
 * Each rule is a pure function over {@link ExtractedData} that returns zero or
 * more {@link Finding}s. Rules are REAL domain checks — none always-passes or
 * always-fails; every one is guarded by a concrete condition derived from the
 * extracted data. HIGH-severity findings (and the MEDIUM ones the plan marks
 * as early-warnings) carry a {@link RiskAlert}.
 *
 * The seven rules mirror `plan.md`'s rule table and the inconsistencies the
 * `product-final.html` demo surfaces (sin-IVA vs con-IVA value mismatch, a
 * closed brand such as "Mac" without "o equivalente", and a restrictive
 * experience requirement).
 */

import type {
  ExtractedData,
  ExtractedItem,
  Finding,
  FindingCategory,
  FindingSeverity,
  Located,
  RiskAlert,
  SourceLocation,
} from "../domain/types.ts";

/** A single declarative rule. `evaluate` is pure and never mutates input. */
export interface RuleDefinition {
  id: string;
  severity: FindingSeverity;
  category: FindingCategory;
  evaluate(extracted: ExtractedData): Finding[];
}

/**
 * Representative ceiling (COP) for the "mínima cuantía" modality. Real
 * thresholds are entity-budget-relative; this fixed value is a defensible
 * MVP stand-in and is documented as such.
 */
export const MINIMA_CUANTIA_THRESHOLD = 211_000_000;

/** Upper bound (days) beyond which an execution term is implausible. */
export const MAX_PLAZO_DIAS = 1800;

/** Closed-brand signals that lock out equivalent products (R-MARCA-CERRADA). */
const CLOSED_BRAND_PATTERNS: RegExp[] = [
  /\bmac\b/,
  /\bmacbook\b/,
  /\bimac\b/,
  /\bipad\b/,
  /\biphone\b/,
  /\bapple\b/,
  /\bintel\s+core\s+i[3579]\b/,
];

/** Clause that neutralises a brand lock. */
const EQUIVALENTE_CLAUSE = /o\s+(?:su\s+)?equivalente/i;

/** Format a number as Colombian pesos with dotted thousands (deterministic). */
export function formatCOP(value: number): string {
  const rounded = Math.round(value).toString();
  return `$${rounded.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}

/** Strip accents + lowercase for robust keyword matching. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function riskAlert(level: FindingSeverity, reason: string): RiskAlert {
  return { level, reason };
}

/** Required fields and whether a miss is HIGH severity (R-CAMPO-OBLIGATORIO). */
const REQUIRED_FIELDS: Array<{
  key: keyof ExtractedData;
  label: string;
  high: boolean;
}> = [
  { key: "objeto", label: "Objeto", high: true },
  { key: "valorSinIva", label: "Valor total sin IVA", high: true },
  { key: "modalidad", label: "Modalidad de selección", high: false },
  { key: "cdpNumero", label: "CDP", high: false },
  { key: "entidad", label: "Entidad contratante", high: false },
  { key: "plazoEjecucion", label: "Plazo de ejecución", high: false },
];

const R_CAMPO_OBLIGATORIO: RuleDefinition = {
  id: "R-CAMPO-OBLIGATORIO",
  severity: "MEDIUM",
  category: "MISSING_FIELD",
  evaluate(extracted) {
    const findings: Finding[] = [];
    for (const field of REQUIRED_FIELDS) {
      const value = extracted[field.key];
      const present =
        value !== undefined &&
        value !== null &&
        !(Array.isArray(value) && value.length === 0);
      if (present) continue;

      const severity: FindingSeverity = field.high ? "HIGH" : "MEDIUM";
      const finding: Finding = {
        id: `R-CAMPO-OBLIGATORIO:${String(field.key)}`,
        ruleId: "R-CAMPO-OBLIGATORIO",
        severity,
        category: "MISSING_FIELD",
        message: `El campo obligatorio "${field.label}" no fue encontrado en el estudio previo. Sin este dato la negociación no puede estructurarse ni validarse.`,
        evidence: `(campo ausente en el documento: ${field.label})`,
        location: { field: String(field.key) },
      };
      if (severity === "HIGH") {
        finding.riskAlert = riskAlert(
          "HIGH",
          `Falta un dato crítico (${field.label}); el proceso no es viable hasta completarlo.`,
        );
      }
      findings.push(finding);
    }
    return findings;
  },
};

const R_PRESUPUESTO_CDP: RuleDefinition = {
  id: "R-PRESUPUESTO-CDP",
  severity: "HIGH",
  category: "COHERENCE",
  evaluate(extracted) {
    const presupuesto = extracted.valorSinIva;
    const cdp = extracted.cdpValor;
    if (!presupuesto || !cdp) return [];
    if (presupuesto.value <= cdp.value) return [];

    return [
      {
        id: "R-PRESUPUESTO-CDP",
        ruleId: "R-PRESUPUESTO-CDP",
        severity: "HIGH",
        category: "COHERENCE",
        message: `El presupuesto sin IVA (${formatCOP(presupuesto.value)}) supera el valor certificado en el CDP (${formatCOP(cdp.value)}). El compromiso excede los recursos disponibles.`,
        evidence:
          cdp.evidence ??
          presupuesto.evidence ??
          `valorSinIva=${presupuesto.value} > cdpValor=${cdp.value}`,
        location: presupuesto.location,
        riskAlert: riskAlert(
          "HIGH",
          "El valor a comprometer supera los recursos certificados en el CDP.",
        ),
      },
    ];
  },
};

const R_VALOR_INCONSISTENTE: RuleDefinition = {
  id: "R-VALOR-INCONSISTENTE",
  severity: "HIGH",
  category: "INCONSISTENCY",
  evaluate(extracted) {
    const sinIva = extracted.valorSinIva;
    const conIva = extracted.valorTotalConIva;
    const cdp = extracted.cdpValor;
    if (!sinIva || !conIva || !cdp) return [];
    // The defect: the estudio declares the "valor máximo" sin IVA, yet the CDP
    // (and the Carta de intención) commit the con-IVA figure — two different
    // amounts presented as the maximum value of the same process.
    if (sinIva.value === conIva.value) return [];
    if (cdp.value !== conIva.value) return [];

    return [
      {
        id: "R-VALOR-INCONSISTENTE",
        ruleId: "R-VALOR-INCONSISTENTE",
        severity: "HIGH",
        category: "INCONSISTENCY",
        message: `Se presentan dos cifras distintas como valor máximo del proceso: el presupuesto sin IVA (${formatCOP(sinIva.value)}) y el valor total con IVA respaldado por el CDP (${formatCOP(conIva.value)}). La FTN y la Carta de intención no coinciden.`,
        evidence:
          `sin IVA ${formatCOP(sinIva.value)} vs con IVA ${formatCOP(conIva.value)}` +
          (conIva.evidence ? ` — ${conIva.evidence}` : ""),
        location: conIva.location,
        riskAlert: riskAlert(
          "HIGH",
          "Ambigüedad del valor máximo contractual entre la FTN (sin IVA) y la Carta/CDP (con IVA).",
        ),
      },
    ];
  },
};

function describeItem(item: ExtractedItem, index: number): string {
  const num = item.numero?.value ?? index + 1;
  return `${num}`;
}

const R_MARCA_CERRADA: RuleDefinition = {
  id: "R-MARCA-CERRADA",
  severity: "MEDIUM",
  category: "COHERENCE",
  evaluate(extracted) {
    const findings: Finding[] = [];
    extracted.items.forEach((item, index) => {
      const descripcion = item.descripcion?.value ?? "";
      const marca = item.marca?.value ?? "";
      const haystack = normalize(`${descripcion} ${marca}`);
      const matched = CLOSED_BRAND_PATTERNS.some((rx) => rx.test(haystack));
      if (!matched) return;
      if (EQUIVALENTE_CLAUSE.test(haystack)) return;

      const num = describeItem(item, index);
      const location: SourceLocation =
        item.marca?.location ?? item.descripcion?.location ?? { field: "items" };
      const evidence =
        item.marca?.evidence ??
        item.descripcion?.evidence ??
        `${descripcion} ${marca}`.trim();

      findings.push({
        id: `R-MARCA-CERRADA:item-${num}`,
        ruleId: "R-MARCA-CERRADA",
        severity: "MEDIUM",
        category: "COHERENCE",
        message: `El ítem ${num} especifica una marca cerrada ("${(marca || descripcion).trim()}") sin la cláusula "o equivalente". Esto direcciona el pliego hacia un único fabricante.`,
        evidence,
        location,
        riskAlert: riskAlert(
          "MEDIUM",
          "Especificación por marca sin equivalencia: posible restricción indebida de la competencia.",
        ),
      });
    });
    return findings;
  },
};

const R_EXPERIENCIA_RESTRICTIVA: RuleDefinition = {
  id: "R-EXPERIENCIA-RESTRICTIVA",
  severity: "MEDIUM",
  category: "COHERENCE",
  evaluate(extracted) {
    const exp = extracted.experienciaExigida;
    if (!exp) return [];
    const norm = normalize(exp.value);
    const unitsMatch = /(\d[\d.]*)\s*(equipos|unidades|bienes|computadores)/.exec(
      norm,
    );
    const hasSecondRequirement =
      /(plataforma|implementaci|audiencias|software|solucion integral)/.test(
        norm,
      );
    if (!unitsMatch || !hasSecondRequirement) return [];

    const quantity = unitsMatch[1] ?? "";
    const unitLabel = unitsMatch[2] ?? "unidades";
    return [
      {
        id: "R-EXPERIENCIA-RESTRICTIVA",
        ruleId: "R-EXPERIENCIA-RESTRICTIVA",
        severity: "MEDIUM",
        category: "COHERENCE",
        message: `La experiencia exigida acumula un volumen mínimo (${quantity} ${unitLabel}) y, de forma conjunta, una segunda implementación específica. Exigir ambos requisitos en un mismo contrato previo limita la pluralidad de oferentes.`,
        evidence: exp.evidence ?? exp.value,
        location: exp.location,
        riskAlert: riskAlert(
          "MEDIUM",
          "Requisitos de experiencia acumulativos que pueden restringir la concurrencia de oferentes.",
        ),
      },
    ];
  },
};

const R_FECHAS_COHERENTES: RuleDefinition = {
  id: "R-FECHAS-COHERENTES",
  severity: "MEDIUM",
  category: "FORMAT",
  evaluate(extracted) {
    const findings: Finding[] = [];
    const pub = extracted.fechaPublicacion;
    const cierre = extracted.fechaCierre;
    const plazo = extracted.plazoEjecucion;

    if (pub && cierre && cierre.value <= pub.value) {
      findings.push({
        id: "R-FECHAS-COHERENTES:orden",
        ruleId: "R-FECHAS-COHERENTES",
        severity: "MEDIUM",
        category: "FORMAT",
        message: `La fecha de cierre (${cierre.value}) es anterior o igual a la fecha de publicación (${pub.value}). La cronología del proceso es incoherente.`,
        evidence:
          `publicación: ${pub.evidence ?? pub.value} / cierre: ${cierre.evidence ?? cierre.value}`.trim(),
        location: cierre.location,
      });
    }

    if (plazo && typeof plazo.dias === "number") {
      if (plazo.dias <= 0 || plazo.dias > MAX_PLAZO_DIAS) {
        findings.push({
          id: "R-FECHAS-COHERENTES:plazo",
          ruleId: "R-FECHAS-COHERENTES",
          severity: "MEDIUM",
          category: "FORMAT",
          message: `El plazo de ejecución (${plazo.dias} días) está fuera del rango razonable (1 a ${MAX_PLAZO_DIAS} días).`,
          evidence: plazo.evidence ?? plazo.value,
          location: plazo.location,
        });
      }
    }

    return findings;
  },
};

const R_MODALIDAD_CUANTIA: RuleDefinition = {
  id: "R-MODALIDAD-CUANTIA",
  severity: "HIGH",
  category: "COHERENCE",
  evaluate(extracted) {
    const modalidad = extracted.modalidad;
    const presupuesto = extracted.valorSinIva;
    if (!modalidad || !presupuesto) return [];
    const norm = normalize(modalidad.value);
    if (!/minima\s+cuantia/.test(norm)) return [];
    if (presupuesto.value <= MINIMA_CUANTIA_THRESHOLD) return [];

    return [
      {
        id: "R-MODALIDAD-CUANTIA",
        ruleId: "R-MODALIDAD-CUANTIA",
        severity: "HIGH",
        category: "COHERENCE",
        message: `La modalidad declarada es "mínima cuantía" pero el presupuesto (${formatCOP(presupuesto.value)}) supera el tope de mínima cuantía (${formatCOP(MINIMA_CUANTIA_THRESHOLD)}). La modalidad de selección no corresponde al valor del proceso.`,
        evidence: modalidad.evidence ?? modalidad.value,
        location: modalidad.location,
        riskAlert: riskAlert(
          "HIGH",
          "Modalidad de selección incompatible con la cuantía del proceso.",
        ),
      },
    ];
  },
};

/** The ordered rule set applied by {@link LocalRuleValidator}. */
export const RULES: RuleDefinition[] = [
  R_CAMPO_OBLIGATORIO,
  R_PRESUPUESTO_CDP,
  R_VALOR_INCONSISTENTE,
  R_MARCA_CERRADA,
  R_EXPERIENCIA_RESTRICTIVA,
  R_FECHAS_COHERENTES,
  R_MODALIDAD_CUANTIA,
];

/** Helper reused by tests / callers that just want a Located value's number. */
export function valueOf<T>(located: Located<T> | undefined): T | undefined {
  return located?.value;
}
