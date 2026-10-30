/**
 * The 7 service interfaces that make up a provider bundle.
 *
 * A "bundle" is one concrete implementation of all seven (the fully-offline
 * `local` bundle, or the thin `aws` bundle). The pipeline and server depend
 * only on these interfaces, never on a concrete provider, so the runtime can
 * swap implementations via `AIDLC_PROVIDER` without touching business logic.
 */

import type {
  Decision,
  DecisionAction,
  DocumentRecord,
  DocumentVersion,
  DraftDocument,
  ExtractedData,
  Finding,
  SearchResult,
} from "../domain/types.ts";

/** Raw input handed to the extractor. One of `text`/`contentBase64` is set. */
export interface ExtractorInput {
  filename: string;
  /** Plain text, when the caller already has it. */
  text?: string;
  /** Base64-encoded document bytes (best-effort decoded to text). */
  contentBase64?: string;
}

/** R1: pull structured data out of a procurement document. */
export interface DocumentExtractor {
  extract(input: ExtractorInput): Promise<ExtractedData>;
}

/** Output of lightweight NLP over the document text. */
export interface NlpResult {
  entities: Array<{ text: string; type: string; score?: number }>;
  keyPhrases: Array<{ text: string; score?: number }>;
}

/** R5/R6: surface entities and key phrases from free text. */
export interface NlpAnalyzer {
  analyze(text: string): Promise<NlpResult>;
}

/** R11/R12: apply business rules, producing findings + risk alerts. */
export interface RuleValidator {
  validate(extracted: ExtractedData): Promise<Finding[]>;
}

/** R2/R3: build an editable draft from the extracted data + decisions. */
export interface DraftGenerator {
  generate(
    extracted: ExtractedData,
    findings: Finding[],
    decisions: Decision[],
  ): Promise<DraftDocument>;
}

/** Opaque blob storage keyed by string (R8 document/version bytes). */
export interface Storage {
  /** Persist raw bytes/text under `key`. */
  put(key: string, value: string): Promise<void>;
  /** Return stored content, or `null` when the key is absent (never throws for a miss). */
  get(key: string): Promise<string | null>;
  /** List keys, optionally restricted to those starting with `prefix`. */
  list(prefix?: string): Promise<string[]>;
}

/** Input used to record a decision against a finding (R7). */
export interface DecisionInput {
  findingId: string;
  action: DecisionAction;
  justification: string;
}

/** R4/R7/R8: the traceability store for documents, decisions, versions. */
export interface TraceStore {
  saveDocument(record: DocumentRecord): Promise<void>;
  getDocument(documentId: string): Promise<DocumentRecord | null>;
  recordDecision(documentId: string, input: DecisionInput): Promise<Decision>;
  addVersion(
    documentId: string,
    version: Omit<DocumentVersion, "version">,
  ): Promise<DocumentVersion>;
  listVersions(documentId: string): Promise<DocumentVersion[]>;
  listDecisions(documentId: string): Promise<Decision[]>;
}

/** R5: index findings and search them lexically. */
export interface SearchIndex {
  index(findings: Finding[], documentId: string): Promise<void>;
  search(query: string): Promise<SearchResult[]>;
}

/** All seven services, aggregated into one swappable bundle. */
export interface ProviderBundle {
  documentExtractor: DocumentExtractor;
  nlpAnalyzer: NlpAnalyzer;
  ruleValidator: RuleValidator;
  draftGenerator: DraftGenerator;
  storage: Storage;
  traceStore: TraceStore;
  searchIndex: SearchIndex;
}
