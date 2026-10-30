/**
 * AgilIA domain types.
 *
 * Shared vocabulary for the whole pipeline: extraction -> analysis ->
 * validation -> draft generation -> persistence. Everything downstream
 * (providers, rules, server) imports from here.
 */

/** Where a piece of data was found inside the source document. */
export interface SourceLocation {
  /** Logical field name the value maps to (e.g. "valorSinIva"). */
  field?: string;
  page?: number;
  section?: string;
  line?: number;
  /** Inclusive start offset into the plain-text document. */
  charStart?: number;
  /** Exclusive end offset into the plain-text document. */
  charEnd?: number;
}

/**
 * A value tied to its provenance in the source document. Every extracted
 * field is wrapped in this so findings can point back to exact locations
 * and quote textual evidence (requirements R5/R6).
 */
export interface Located<T> {
  value: T;
  location: SourceLocation;
  /** Verbatim snippet from the document that supports `value`. */
  evidence?: string;
}

/** A single line item in a procurement document. */
export interface ExtractedItem {
  numero?: Located<number>;
  descripcion: Located<string>;
  cantidad?: Located<number>;
  /** Brand, when explicitly named (feeds the closed-brand rule). */
  marca?: Located<string>;
}

/**
 * Structured data extracted from an "estudio previo". Every field is
 * optional: when an anchor is missing the extractor leaves it undefined
 * rather than throwing, and the validator reports missing mandatory fields.
 */
export interface ExtractedData {
  entidad?: Located<string>;
  procesoId?: Located<string>;
  objeto?: Located<string>;
  modalidad?: Located<string>;
  valorSinIva?: Located<number>;
  valorTotalConIva?: Located<number>;
  cdpNumero?: Located<string>;
  cdpValor?: Located<number>;
  fechaPublicacion?: Located<string>;
  fechaCierre?: Located<string>;
  /** Raw plazo text plus, when parseable, the duration in days. */
  plazoEjecucion?: Located<string> & { dias?: number };
  items: ExtractedItem[];
  experienciaExigida?: Located<string>;
  garantias?: Located<string>;
}

export type FindingSeverity = "LOW" | "MEDIUM" | "HIGH";

export type FindingCategory =
  | "MISSING_FIELD"
  | "INCONSISTENCY"
  | "COHERENCE"
  | "FORMAT";

/** Early-warning risk annotation attached to a finding (R12). */
export interface RiskAlert {
  level: FindingSeverity;
  reason: string;
}

/** A validation finding produced by the rule engine. */
export interface Finding {
  id: string;
  ruleId: string;
  severity: FindingSeverity;
  category: FindingCategory;
  /** Technical explanation of the problem (R6). */
  message: string;
  /** Textual evidence quoted from the document (R5/R6). */
  evidence: string;
  location: SourceLocation;
  /** Present for HIGH-severity findings that warrant an early warning. */
  riskAlert?: RiskAlert;
}

export type DecisionAction = "ACCEPT" | "REJECT";

/** A recorded human decision about a finding (R7). */
export interface Decision {
  id: string;
  findingId: string;
  action: DecisionAction;
  justification: string;
  /** ISO-8601 timestamp. */
  recordedAt: string;
}

/** A persisted version of a generated draft (R8). */
export interface DocumentVersion {
  version: number;
  /** ISO-8601 timestamp. */
  createdAt: string;
  /** Storage key for the draft blob backing this version. */
  storageKey: string;
  note?: string;
}

/** One field within a draft section; editable by the user (R3/R4). */
export interface DraftField {
  label: string;
  value: string;
  editable: boolean;
  /** Shown when the source value is missing. */
  placeholder?: string;
  /** Finding id that flagged this field, when applicable. */
  flaggedByFindingId?: string;
}

export interface DraftSection {
  id: string;
  title: string;
  fields: DraftField[];
}

/** A generated editable draft (FTN/FTP/Carta), structured + Markdown. */
export interface DraftDocument {
  documentId: string;
  version: number;
  format: "markdown";
  sections: DraftSection[];
  /** Full Markdown rendering for display/download. */
  content: string;
}

export type DocumentStatus =
  | "RECEIVED"
  | "EXTRACTED"
  | "ANALYZED"
  | "VALIDATED"
  | "DRAFTED"
  | "ERROR";

/** The complete persisted record for a processed document. */
export interface DocumentRecord {
  documentId: string;
  status: DocumentStatus;
  filename?: string;
  extracted?: ExtractedData;
  findings: Finding[];
  alerts: RiskAlert[];
  versions: DocumentVersion[];
  decisions: Decision[];
  createdAt: string;
  updatedAt: string;
}

/** A single ranked hit from the search index (R5). */
export interface SearchResult {
  documentId: string;
  findingId: string;
  score: number;
  snippet: string;
  location: SourceLocation;
}
