/**
 * The document-processing pipeline.
 *
 * `runPipeline(input, providers)` runs the full flow end to end:
 *   extract → analyze → validate → derive alerts → generate draft → persist.
 *
 * Every stage is wrapped so a failure is surfaced with the stage name and
 * context — there are no silent failures. Persistence writes the document
 * record and draft version to the TraceStore/Storage and indexes findings in
 * the SearchIndex. The resolved {@link DocumentRecord} is returned.
 */

import { randomUUID } from "node:crypto";
import type {
  DocumentRecord,
  DraftDocument,
  ExtractedData,
  Finding,
  RiskAlert,
} from "../domain/types.ts";
import type { ExtractorInput, ProviderBundle } from "../providers/interfaces.ts";

/** Input accepted by the pipeline — mirrors the extractor input plus metadata. */
export interface PipelineInput extends ExtractorInput {
  /** Optional caller-supplied id; a UUID is generated when absent. */
  documentId?: string;
  metadata?: { entidad?: string; procesoId?: string };
}

/** Run one stage, re-throwing any error with the stage name attached. */
async function stage<T>(name: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw new Error(
      `runPipeline: stage "${name}" failed: ${(err as Error).message}`,
    );
  }
}

/** Resolve the text used for NLP analysis (text wins, else decode base64). */
function resolveText(input: PipelineInput): string {
  if (typeof input.text === "string" && input.text.length > 0) {
    return input.text;
  }
  if (
    typeof input.contentBase64 === "string" &&
    input.contentBase64.length > 0
  ) {
    try {
      return Buffer.from(input.contentBase64, "base64").toString("utf8");
    } catch {
      return "";
    }
  }
  return "";
}

export async function runPipeline(
  input: PipelineInput,
  providers: ProviderBundle,
): Promise<DocumentRecord> {
  if (!input || typeof input !== "object") {
    throw new Error("runPipeline: input is required");
  }
  if (!providers || typeof providers !== "object") {
    throw new Error("runPipeline: a provider bundle is required");
  }

  const documentId = input.documentId?.trim() || randomUUID();
  const now = new Date().toISOString();

  const extracted: ExtractedData = await stage("extract", () =>
    providers.documentExtractor.extract(input),
  );

  // Analyze is part of the flow; its output is persisted as a trace blob so it
  // is never silently discarded, even though the record keeps structured data.
  const nlp = await stage("analyze", () =>
    providers.nlpAnalyzer.analyze(resolveText(input)),
  );

  const findings: Finding[] = await stage("validate", () =>
    providers.ruleValidator.validate(extracted),
  );

  const alerts: RiskAlert[] = findings
    .map((f) => f.riskAlert)
    .filter((a): a is RiskAlert => a !== undefined);

  const draft: DraftDocument = await stage("draft", () =>
    providers.draftGenerator.generate(extracted, findings, []),
  );
  draft.documentId = documentId;

  const record: DocumentRecord = {
    documentId,
    status: "DRAFTED",
    filename: input.filename,
    extracted,
    findings,
    alerts,
    versions: [],
    decisions: [],
    createdAt: now,
    updatedAt: now,
  };

  await stage("persist", async () => {
    // 1. Save the document record first (addVersion requires it to exist).
    await providers.traceStore.saveDocument(record);

    // 2. Persist the NLP trace + draft blob.
    await providers.storage.put(
      `nlp/${documentId}.json`,
      JSON.stringify(nlp, null, 2),
    );
    const draftKey = `drafts/${documentId}/draft.md`;
    await providers.storage.put(draftKey, draft.content);

    // 3. Register the draft as version 1.
    const version = await providers.traceStore.addVersion(documentId, {
      createdAt: new Date().toISOString(),
      storageKey: draftKey,
      note: "Borrador inicial generado por el pipeline",
    });
    draft.version = version.version;

    // 4. Index findings for lexical search.
    await providers.searchIndex.index(findings, documentId);
  });

  const persisted = await providers.traceStore.getDocument(documentId);
  return persisted ?? record;
}
