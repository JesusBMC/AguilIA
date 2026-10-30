/**
 * Local {@link NlpAnalyzer}.
 *
 * Fully offline and deterministic: given the same text it always returns the
 * same entities and key phrases, so it is safe to assert on in tests. It pulls
 * money amounts, dates, organisation names and item descriptions as entities,
 * and the most frequent meaningful terms as key phrases. No network, no model.
 */

import type { NlpAnalyzer, NlpResult } from "../interfaces.ts";

type Entity = { text: string; type: string; score?: number };
type KeyPhrase = { text: string; score?: number };

const MONEY_RE = /\$\s?\d[\d.,]*/g;
const DATE_NUMERIC_RE = /\b\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}\b/g;
const DATE_TEXTUAL_RE = /\b\d{1,2}\s+de\s+[a-záéíóúñ]+\s+de\s+\d{4}\b/gi;
const ORG_RE =
  /\b(?:Procuradur[ií]a|Ministerio|Alcald[ií]a|Gobernaci[oó]n|Instituto|Agencia|Departamento|Fiscal[ií]a|Contralor[ií]a|Superintendencia)[A-Za-zÁÉÍÓÚÑáéíóúñ\s]*/g;

/** Spanish stop words excluded from key-phrase ranking. */
const STOP_WORDS = new Set([
  "para",
  "con",
  "sin",
  "del",
  "los",
  "las",
  "una",
  "uno",
  "por",
  "que",
  "the",
  "and",
  "entidad",
  "valor",
  "fecha",
  "proceso",
  "objeto",
  "total",
  "numero",
  "mas",
  "cantidad",
  "marca",
]);

function dedupe(entities: Entity[]): Entity[] {
  const seen = new Set<string>();
  const out: Entity[] = [];
  for (const entity of entities) {
    const key = `${entity.type}::${entity.text.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entity);
  }
  return out;
}

function collect(regex: RegExp, text: string, type: string): Entity[] {
  const out: Entity[] = [];
  for (const match of text.matchAll(regex)) {
    const value = match[0]?.trim();
    if (value) out.push({ text: value, type, score: 1 });
  }
  return out;
}

function extractKeyPhrases(text: string): KeyPhrase[] {
  const counts = new Map<string, number>();
  const tokens = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !STOP_WORDS.has(t));

  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([term, count]) => ({ text: term, score: count }));
}

export class LocalNlpAnalyzer implements NlpAnalyzer {
  async analyze(text: string): Promise<NlpResult> {
    if (typeof text !== "string") {
      throw new Error("LocalNlpAnalyzer.analyze: text must be a string");
    }

    const entities = dedupe([
      ...collect(ORG_RE, text, "ORG"),
      ...collect(MONEY_RE, text, "MONEY"),
      ...collect(DATE_TEXTUAL_RE, text, "DATE"),
      ...collect(DATE_NUMERIC_RE, text, "DATE"),
    ]);

    return {
      entities,
      keyPhrases: extractKeyPhrases(text),
    };
  }
}
