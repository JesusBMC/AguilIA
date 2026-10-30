/**
 * In-memory lexical search over findings, scored with a BM25-style ranking.
 *
 * Each indexed finding becomes a document whose text is `message + evidence`.
 * `search` tokenizes the query, scores every indexed finding by BM25 term
 * weighting (TF saturation + IDF), and returns ranked {@link SearchResult}s
 * with a snippet and the finding's location. An empty index or a query with
 * no matching terms returns `[]`.
 */

import type { Finding, SearchResult, SourceLocation } from "../../domain/types.ts";
import type { SearchIndex } from "../interfaces.ts";

interface IndexedDoc {
  documentId: string;
  findingId: string;
  text: string;
  tokens: string[];
  termFreq: Map<string, number>;
  length: number;
  location: SourceLocation;
}

// Standard BM25 free parameters.
const K1 = 1.5;
const B = 0.75;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

function buildSnippet(text: string, queryTokens: string[]): string {
  const lower = text.toLowerCase();
  let hitIndex = -1;
  for (const token of queryTokens) {
    const idx = lower.indexOf(token);
    if (idx >= 0 && (hitIndex === -1 || idx < hitIndex)) hitIndex = idx;
  }
  if (hitIndex === -1) {
    return text.length > 160 ? `${text.slice(0, 157)}...` : text;
  }
  const start = Math.max(0, hitIndex - 40);
  const end = Math.min(text.length, hitIndex + 120);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";
  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}

export class LocalSearchIndex implements SearchIndex {
  private readonly docs = new Map<string, IndexedDoc>();

  async index(findings: Finding[], documentId: string): Promise<void> {
    if (!Array.isArray(findings)) {
      throw new Error("LocalSearchIndex.index: findings must be an array");
    }
    for (const finding of findings) {
      const text = `${finding.message ?? ""} ${finding.evidence ?? ""}`.trim();
      const tokens = tokenize(text);
      const termFreq = new Map<string, number>();
      for (const token of tokens) {
        termFreq.set(token, (termFreq.get(token) ?? 0) + 1);
      }
      // Key by documentId+findingId so re-indexing updates in place.
      this.docs.set(`${documentId}::${finding.id}`, {
        documentId,
        findingId: finding.id,
        text,
        tokens,
        termFreq,
        length: tokens.length,
        location: finding.location ?? {},
      });
    }
  }

  async search(query: string): Promise<SearchResult[]> {
    const queryTokens = tokenize(query ?? "");
    const docs = [...this.docs.values()];
    if (queryTokens.length === 0 || docs.length === 0) {
      return [];
    }

    const totalDocs = docs.length;
    const avgLength =
      docs.reduce((sum, d) => sum + d.length, 0) / totalDocs || 1;

    // Document frequency per query term.
    const docFreq = new Map<string, number>();
    for (const token of new Set(queryTokens)) {
      let df = 0;
      for (const doc of docs) {
        if (doc.termFreq.has(token)) df++;
      }
      docFreq.set(token, df);
    }

    const results: SearchResult[] = [];
    for (const doc of docs) {
      let score = 0;
      for (const token of queryTokens) {
        const tf = doc.termFreq.get(token);
        if (!tf) continue;
        const df = docFreq.get(token) ?? 0;
        // BM25 IDF with +1 to keep it non-negative.
        const idf = Math.log(1 + (totalDocs - df + 0.5) / (df + 0.5));
        const denom = tf + K1 * (1 - B + (B * doc.length) / avgLength);
        score += idf * ((tf * (K1 + 1)) / denom);
      }
      if (score > 0) {
        results.push({
          documentId: doc.documentId,
          findingId: doc.findingId,
          score,
          snippet: buildSnippet(doc.text, queryTokens),
          location: doc.location,
        });
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }
}
