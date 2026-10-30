/**
 * Pure, dependency-free parsing of a procurement "estudio previo" plain-text
 * string into {@link ExtractedData}.
 *
 * Every field is located by one or more textual anchors. When an anchor is
 * absent the field is left `undefined` — this module NEVER throws on missing
 * data. Each located value carries char offsets into the source text plus a
 * verbatim evidence snippet so findings can point back to the document.
 */

import type {
  ExtractedData,
  ExtractedItem,
  Located,
  SourceLocation,
} from "../domain/types.ts";

/**
 * Parse a Colombian-formatted currency string into a number.
 *
 * Handles values like "$51.460.675.487", "51.460.675.487 COP",
 * "$ 1.234.567,89". Dots are thousands separators; a trailing comma marks
 * decimals. Returns `undefined` when no digits are present.
 */
export function parseColombianCurrency(raw: string): number | undefined {
  if (typeof raw !== "string") return undefined;
  // Keep digits, dots and commas only.
  const cleaned = raw.replace(/[^\d.,]/g, "");
  if (!/\d/.test(cleaned)) return undefined;

  let normalized: string;
  if (cleaned.includes(",")) {
    // Comma is the decimal separator; dots are thousands separators.
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else {
    // Dots are thousands separators.
    normalized = cleaned.replace(/\./g, "");
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : undefined;
}

/** Compute 1-based line number for a char offset (best-effort location aid). */
function lineAt(text: string, charIndex: number): number {
  let line = 1;
  for (let i = 0; i < charIndex && i < text.length; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}

/**
 * Find the first match of any anchor pattern and return a Located wrapper.
 * Each pattern MUST expose capture group 1 as the value to extract.
 */
function locate(
  text: string,
  field: string,
  patterns: RegExp[],
): Located<string> | undefined {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match && typeof match[1] === "string") {
      const value = match[1].trim();
      if (!value) continue;
      // Offset of the captured value within the overall match.
      const valueOffsetInMatch = match[0].indexOf(match[1]);
      const charStart = match.index + Math.max(0, valueOffsetInMatch);
      const charEnd = charStart + match[1].length;
      const location: SourceLocation = {
        field,
        line: lineAt(text, charStart),
        charStart,
        charEnd,
      };
      return { value, location, evidence: match[0].trim() };
    }
  }
  return undefined;
}

/** Wrap a numeric parse of a located string field, preserving its location. */
function toNumberLocated(
  located: Located<string> | undefined,
  parse: (raw: string) => number | undefined,
): Located<number> | undefined {
  if (!located) return undefined;
  const num = parse(located.value);
  if (num === undefined) return undefined;
  return { value: num, location: located.location, evidence: located.evidence };
}

const SPANISH_MONTHS: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

/**
 * Best-effort normalization of a Colombian date expression to ISO `YYYY-MM-DD`.
 * Supports `dd/mm/yyyy`, `dd-mm-yyyy` and `dd de <mes> de yyyy`. Returns the
 * original trimmed string when it cannot be parsed (never throws).
 */
export function normalizeDate(raw: string): string {
  const text = raw.trim();

  const numeric = /(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/.exec(text);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]);
    let year = Number(numeric[3]);
    if (year < 100) year += 2000;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  const textual = /(\d{1,2})\s+de\s+([a-záéíóúñ]+)\s+de\s+(\d{4})/i.exec(text);
  if (textual) {
    const day = Number(textual[1]);
    const monthName = textual[2]?.toLowerCase() ?? "";
    const month = SPANISH_MONTHS[monthName];
    const year = Number(textual[3]);
    if (month && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  return text;
}

/** Parse a plazo expression into a day count, when one is stated explicitly. */
function parsePlazoDays(raw: string): number | undefined {
  const match = /(\d+)\s*d[ií]as?/i.exec(raw);
  if (match && match[1]) {
    const days = Number(match[1]);
    return Number.isFinite(days) ? days : undefined;
  }
  const meses = /(\d+)\s*mes(?:es)?/i.exec(raw);
  if (meses && meses[1]) {
    const months = Number(meses[1]);
    return Number.isFinite(months) ? months * 30 : undefined;
  }
  return undefined;
}

/**
 * Parse the items / bienes section. Looks for numbered lines of the form:
 *   `1. <descripcion> | Cantidad: <n> | Marca: <marca>`
 * or `Ítem 1: <descripcion> - cantidad <n> - marca <marca>`.
 * Marca and cantidad are optional. Returns [] when no items are found.
 */
function extractItems(text: string): ExtractedItem[] {
  const items: ExtractedItem[] = [];
  const lineRegex =
    /^\s*(?:[íi]tem\s*)?(\d{1,3})[.):\-]\s*(.+)$/gim;

  let match: RegExpExecArray | null;
  while ((match = lineRegex.exec(text)) !== null) {
    const numero = Number(match[1]);
    const body = (match[2] ?? "").trim();
    if (!body) continue;

    const lineStart = match.index + match[0].indexOf(body);
    const location: SourceLocation = {
      field: "items",
      line: lineAt(text, lineStart),
      charStart: lineStart,
      charEnd: lineStart + body.length,
    };

    // Pull optional cantidad / marca annotations out of the body.
    const cantidadMatch = /cantidad[:\s]*([\d.]+)/i.exec(body);
    const marcaMatch = /marca[:\s]*([^|;\n]+)/i.exec(body);

    const descripcion = body
      .replace(/[|;\-]?\s*cantidad[:\s]*[\d.]+/i, "")
      .replace(/[|;\-]?\s*marca[:\s]*[^|;\n]+/i, "")
      .replace(/[|;]+\s*$/, "")
      .trim();

    const item: ExtractedItem = {
      numero: Number.isFinite(numero)
        ? { value: numero, location, evidence: match[0].trim() }
        : undefined,
      descripcion: {
        value: descripcion || body,
        location,
        evidence: match[0].trim(),
      },
    };

    if (cantidadMatch?.[1]) {
      const cantidad = Number(cantidadMatch[1].replace(/\./g, ""));
      if (Number.isFinite(cantidad)) {
        item.cantidad = { value: cantidad, location, evidence: cantidadMatch[0] };
      }
    }
    if (marcaMatch?.[1]) {
      item.marca = {
        value: marcaMatch[1].trim(),
        location,
        evidence: marcaMatch[0].trim(),
      };
    }
    items.push(item);
  }
  return items;
}

/**
 * Parse a full estudio-previo text into {@link ExtractedData}. Missing anchors
 * produce `undefined` fields; this function never throws for well-formed input.
 */
export function extractFields(text: string): ExtractedData {
  const source = typeof text === "string" ? text : "";

  const entidad = locate(source, "entidad", [
    /entidad(?:\s+contratante)?\s*[:\-]\s*(.+)/i,
  ]);
  const procesoId = locate(source, "procesoId", [
    /(?:proceso|n[uú]mero de proceso|id del proceso)\s*(?:n[.º°]?\s*)?[:\-]?\s*([A-Z0-9][A-Z0-9\-]{3,})/i,
  ]);
  const objeto = locate(source, "objeto", [
    /objeto(?:\s+del?\s+(?:proceso|contrato))?\s*[:\-]\s*(.+)/i,
  ]);
  const modalidad = locate(source, "modalidad", [
    /modalidad(?:\s+de\s+(?:selecci[oó]n|contrataci[oó]n))?\s*[:\-]\s*(.+)/i,
  ]);

  const valorSinIvaStr = locate(source, "valorSinIva", [
    /valor\s+(?:total\s+)?sin\s+iva\s*[:\-]?\s*(\$?\s?[\d.,]+)/i,
    /presupuesto\s+(?:oficial\s+)?(?:estimado\s+)?\(?\s*sin\s+iva\s*\)?\s*[:\-]?\s*(\$?\s?[\d.,]+)/i,
  ]);
  const valorConIvaStr = locate(source, "valorTotalConIva", [
    /valor\s+total\s+con\s+iva(?:\s+y\s+costos)?\s*[:\-]?\s*(\$?\s?[\d.,]+)/i,
    /presupuesto\s+total\s+\(?\s*con\s+iva[^$\d]*\)?\s*[:\-]?\s*(\$?\s?[\d.,]+)/i,
  ]);

  const cdpNumero = locate(source, "cdpNumero", [
    /cdp\s*(?:n[o.º°]*\s*)?[:\-]?\s*([0-9][0-9\-]*)/i,
    /certificado de disponibilidad presupuestal\s*(?:n[o.º°]*\s*)?[:\-]?\s*([0-9][0-9\-]*)/i,
  ]);
  const cdpValorStr = locate(source, "cdpValor", [
    /cdp[^$\n]*?(?:por\s+(?:valor\s+de|un\s+valor\s+de)|valor)\s*[:\-]?\s*(\$?\s?[\d.,]+)/i,
    /valor\s+(?:del\s+)?cdp\s*[:\-]?\s*(\$?\s?[\d.,]+)/i,
  ]);

  const fechaPublicacionRaw = locate(source, "fechaPublicacion", [
    /fecha\s+de\s+publicaci[oó]n\s*[:\-]\s*(.+)/i,
  ]);
  const fechaCierreRaw = locate(source, "fechaCierre", [
    /fecha\s+de\s+cierre\s*[:\-]\s*(.+)/i,
  ]);
  const plazoRaw = locate(source, "plazoEjecucion", [
    /plazo\s+de\s+(?:ejecuci[oó]n|entrega)\s*[:\-]\s*(.+)/i,
  ]);

  const experienciaExigida = locate(source, "experienciaExigida", [
    /experiencia\s+(?:exigida|requerida|m[ií]nima)\s*[:\-]\s*(.+)/i,
  ]);
  const garantias = locate(source, "garantias", [
    /garant[ií]as?\s*(?:exigidas?|requeridas?)?\s*[:\-]\s*(.+)/i,
  ]);

  const fechaPublicacion = fechaPublicacionRaw
    ? {
        value: normalizeDate(fechaPublicacionRaw.value),
        location: fechaPublicacionRaw.location,
        evidence: fechaPublicacionRaw.evidence,
      }
    : undefined;
  const fechaCierre = fechaCierreRaw
    ? {
        value: normalizeDate(fechaCierreRaw.value),
        location: fechaCierreRaw.location,
        evidence: fechaCierreRaw.evidence,
      }
    : undefined;

  const plazoEjecucion = plazoRaw
    ? Object.assign({}, plazoRaw, { dias: parsePlazoDays(plazoRaw.value) })
    : undefined;

  const data: ExtractedData = {
    entidad,
    procesoId,
    objeto,
    modalidad,
    valorSinIva: toNumberLocated(valorSinIvaStr, parseColombianCurrency),
    valorTotalConIva: toNumberLocated(valorConIvaStr, parseColombianCurrency),
    cdpNumero,
    cdpValor: toNumberLocated(cdpValorStr, parseColombianCurrency),
    fechaPublicacion,
    fechaCierre,
    plazoEjecucion,
    items: extractItems(source),
    experienciaExigida,
    garantias,
  };

  return data;
}
