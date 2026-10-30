/**
 * Thin Textract-backed {@link DocumentExtractor} implementation.
 *
 * When raw document bytes are supplied (base64), this calls the synchronous
 * Textract `AnalyzeDocument` API and concatenates the detected LINE blocks
 * into plain text. When the caller already has text, Textract is skipped.
 *
 * Mapping Textract blocks into the structured {@link ExtractedData} fields
 * (entidad, valorSinIva, items, ...) is a domain task shared with the local
 * extractor's regex anchors; wiring that mapping onto Textract output is
 * marked `// FUTURE WIRING`. This thin version returns the raw text under
 * `objeto` as evidence plus an empty `items` list so the shape always
 * type-checks and never silently drops the Textract result.
 */

import {
  AnalyzeDocumentCommand,
  TextractClient,
  type Block,
} from "@aws-sdk/client-textract";

import type { AppConfig } from "../../config.ts";
import type { ExtractedData } from "../../domain/types.ts";
import type { DocumentExtractor, ExtractorInput } from "../interfaces.ts";
import { callService, resolveAwsSettings } from "./aws-common.ts";

export class AwsDocumentExtractor implements DocumentExtractor {
  private readonly client: TextractClient;

  constructor(config: AppConfig) {
    const settings = resolveAwsSettings(config);
    this.client = new TextractClient({ region: settings.region });
  }

  async extract(input: ExtractorInput): Promise<ExtractedData> {
    const text = input.text ?? (await this.detectText(input.contentBase64));

    // FUTURE WIRING: map `text` through the shared field-extraction anchors
    // (see src/rules/field-extraction.ts) to populate entidad/valorSinIva/
    // items/etc. with per-field locations. The thin bundle surfaces the raw
    // Textract text as `objeto` evidence so the extraction result is never
    // discarded, and leaves other fields undefined (the validator reports
    // them as missing, exactly like the local path on a sparse document).
    const extracted: ExtractedData = { items: [] };
    if (text) {
      extracted.objeto = {
        value: text.slice(0, 2000),
        location: { field: "objeto" },
        evidence: text.slice(0, 500),
      };
    }
    return extracted;
  }

  /** Run synchronous Textract over base64 bytes and join LINE blocks. */
  private async detectText(contentBase64?: string): Promise<string> {
    if (!contentBase64) {
      return "";
    }
    const bytes = Buffer.from(contentBase64, "base64");
    const response = await callService("textract:AnalyzeDocument", () =>
      this.client.send(
        new AnalyzeDocumentCommand({
          Document: { Bytes: bytes },
          FeatureTypes: ["FORMS", "TABLES"],
        }),
      ),
    );
    const blocks: Block[] = response.Blocks ?? [];
    return blocks
      .filter((block) => block.BlockType === "LINE" && block.Text)
      .map((block) => block.Text)
      .join("\n");
  }
}
