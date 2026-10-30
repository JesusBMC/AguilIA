/**
 * Local {@link DocumentExtractor}.
 *
 * Resolves the document text from the input (`text` wins; otherwise
 * `contentBase64` is decoded as UTF-8) and delegates the actual parsing to the
 * pure {@link extractFields} function. PDF bytes are not parsed binary-wise in
 * local mode — the decoder makes a best-effort pass over the decoded buffer and
 * relies on any embedded plain text (documented limitation). Never throws for
 * missing fields; throws only when neither `text` nor `contentBase64` is given.
 */

import type { ExtractedData } from "../../domain/types.ts";
import type { DocumentExtractor, ExtractorInput } from "../interfaces.ts";
import { extractFields } from "../../rules/field-extraction.ts";

/** Marker that precedes the readable text stream inside many PDF files. */
const PDF_MAGIC = "%PDF-";

function decodeBase64ToText(contentBase64: string): string {
  let buffer: Buffer;
  try {
    buffer = Buffer.from(contentBase64, "base64");
  } catch (err) {
    throw new Error(
      `LocalDocumentExtractor: invalid base64 content: ${(err as Error).message}`,
    );
  }
  const decoded = buffer.toString("utf8");

  // Best-effort PDF handling: we cannot fully parse PDF locally, so we keep the
  // decoded bytes as-is and let field extraction scan any embedded plain text.
  if (decoded.startsWith(PDF_MAGIC)) {
    // Strip non-printable control chars so anchors in text objects stay visible.
    return decoded.replace(/[\u0000-\u0008\u000e-\u001f]/g, " ");
  }
  return decoded;
}

export class LocalDocumentExtractor implements DocumentExtractor {
  async extract(input: ExtractorInput): Promise<ExtractedData> {
    if (!input || typeof input !== "object") {
      throw new Error("LocalDocumentExtractor: input is required");
    }

    let text: string;
    if (typeof input.text === "string" && input.text.length > 0) {
      text = input.text;
    } else if (
      typeof input.contentBase64 === "string" &&
      input.contentBase64.length > 0
    ) {
      text = decodeBase64ToText(input.contentBase64);
    } else {
      throw new Error(
        "LocalDocumentExtractor: either 'text' or 'contentBase64' must be provided",
      );
    }

    return extractFields(text);
  }
}
