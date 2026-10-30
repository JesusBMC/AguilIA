/**
 * Thin Comprehend-backed {@link NlpAnalyzer} implementation.
 *
 * Calls `DetectEntities` and `DetectKeyPhrases` with the Spanish language code
 * and maps the responses onto {@link NlpResult}. Comprehend's synchronous APIs
 * cap input at 5000 UTF-8 bytes, so the text is truncated to that budget.
 */

import {
  ComprehendClient,
  DetectEntitiesCommand,
  DetectKeyPhrasesCommand,
  type LanguageCode,
} from "@aws-sdk/client-comprehend";

import type { AppConfig } from "../../config.ts";
import type { NlpAnalyzer, NlpResult } from "../interfaces.ts";
import { callService, resolveAwsSettings } from "./aws-common.ts";

/** Comprehend sync APIs accept at most 5000 UTF-8 bytes per call. */
const MAX_BYTES = 5000;

export class AwsNlpAnalyzer implements NlpAnalyzer {
  private readonly client: ComprehendClient;
  private readonly languageCode: LanguageCode;

  constructor(config: AppConfig) {
    const settings = resolveAwsSettings(config);
    // Comprehend accepts a fixed set of language codes; the configured value
    // (default "es") is validated at the service boundary.
    this.languageCode = settings.comprehendLanguage as LanguageCode;
    this.client = new ComprehendClient({ region: settings.region });
  }

  async analyze(text: string): Promise<NlpResult> {
    if (typeof text !== "string") {
      throw new TypeError("AwsNlpAnalyzer.analyze: text must be a string");
    }
    const truncated = truncateUtf8(text, MAX_BYTES);

    const entitiesResponse = await callService("comprehend:DetectEntities", () =>
      this.client.send(
        new DetectEntitiesCommand({
          Text: truncated,
          LanguageCode: this.languageCode,
        }),
      ),
    );
    const keyPhrasesResponse = await callService(
      "comprehend:DetectKeyPhrases",
      () =>
        this.client.send(
          new DetectKeyPhrasesCommand({
            Text: truncated,
            LanguageCode: this.languageCode,
          }),
        ),
    );

    const entities = (entitiesResponse.Entities ?? [])
      .filter((e) => e.Text)
      .map((e) => ({
        text: e.Text as string,
        type: e.Type ?? "UNKNOWN",
        score: e.Score,
      }));
    const keyPhrases = (keyPhrasesResponse.KeyPhrases ?? [])
      .filter((p) => p.Text)
      .map((p) => ({ text: p.Text as string, score: p.Score }));

    return { entities, keyPhrases };
  }
}

/** Truncate a string so its UTF-8 byte length does not exceed `maxBytes`. */
function truncateUtf8(text: string, maxBytes: number): string {
  const encoded = new TextEncoder().encode(text);
  if (encoded.length <= maxBytes) {
    return text;
  }
  const slice = encoded.slice(0, maxBytes);
  return new TextDecoder("utf-8", { fatal: false }).decode(slice);
}
