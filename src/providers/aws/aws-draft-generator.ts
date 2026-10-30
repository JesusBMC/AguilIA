/**
 * Thin Bedrock-backed {@link DraftGenerator} implementation.
 *
 * Invokes an Anthropic Claude model on Bedrock to draft the procurement
 * document from the extracted data, open findings, and recorded decisions,
 * returning the model's Markdown as the draft `content`.
 *
 * The local generator produces a fully structured FTN/FTP/Carta section tree
 * with per-field placeholders and finding markers. Reconstructing that exact
 * structured section model from free-form model output is marked
 * `// FUTURE WIRING`; this thin version returns a single section carrying the
 * generated Markdown so the {@link DraftDocument} shape is always valid and the
 * model output is never discarded.
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";

import type { AppConfig } from "../../config.ts";
import type {
  Decision,
  DraftDocument,
  ExtractedData,
  Finding,
} from "../../domain/types.ts";
import type { DraftGenerator } from "../interfaces.ts";
import {
  AwsProviderError,
  callService,
  resolveAwsSettings,
} from "./aws-common.ts";

export class AwsDraftGenerator implements DraftGenerator {
  private readonly client: BedrockRuntimeClient;
  private readonly modelId: string;

  constructor(config: AppConfig) {
    const settings = resolveAwsSettings(config);
    this.modelId = settings.draftModelId;
    this.client = new BedrockRuntimeClient({ region: settings.region });
  }

  async generate(
    extracted: ExtractedData,
    findings: Finding[],
    decisions: Decision[],
  ): Promise<DraftDocument> {
    const prompt =
      "Genera un borrador en Markdown de los documentos de adquisicion (FTN, FTP y Carta de intencion) " +
      "a partir de los datos extraidos. Marca los campos faltantes con `[[COMPLETAR: <campo>]]` y " +
      "senala los campos afectados por un hallazgo. Respeta las decisiones (ACCEPT/REJECT) ya tomadas.\n\n" +
      `Datos: ${JSON.stringify(extracted).slice(0, 6000)}\n\n` +
      `Hallazgos: ${JSON.stringify(findings).slice(0, 4000)}\n\n` +
      `Decisiones: ${JSON.stringify(decisions).slice(0, 2000)}`;

    const response = await callService("bedrock:InvokeModel draft", () =>
      this.client.send(
        new InvokeModelCommand({
          modelId: this.modelId,
          contentType: "application/json",
          accept: "application/json",
          body: JSON.stringify({
            anthropic_version: "bedrock-2023-05-31",
            max_tokens: 8192,
            messages: [{ role: "user", content: prompt }],
          }),
        }),
      ),
    );

    const content = extractClaudeText(response.body);

    // FUTURE WIRING: parse `content` into the structured FTN/FTP/Carta
    // DraftSection[] with per-field DraftField entries. The thin bundle keeps
    // the generated Markdown as a single section so nothing is dropped.
    return {
      documentId: "",
      version: 1,
      format: "markdown",
      sections: [
        {
          id: "borrador",
          title: "Borrador generado (Bedrock)",
          fields: [
            {
              label: "Contenido",
              value: content,
              editable: true,
            },
          ],
        },
      ],
      content,
    };
  }
}

/** Decode the Bedrock response bytes and join the model's text content. */
function extractClaudeText(body: Uint8Array | undefined): string {
  if (!body) {
    return "";
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } catch (err) {
    throw new AwsProviderError("parse bedrock response", err);
  }
  const content = (parsed as { content?: Array<{ text?: string }> }).content;
  if (!Array.isArray(content)) {
    return "";
  }
  return content.map((part) => part.text ?? "").join("");
}
