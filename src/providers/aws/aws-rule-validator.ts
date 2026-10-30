/**
 * Thin Bedrock-backed {@link RuleValidator} implementation.
 *
 * Invokes an Anthropic Claude model on Bedrock with the extracted data and a
 * rule-checking prompt, then parses a findings array out of the model reply.
 *
 * The authoritative, deterministic rules live in src/rules/rule-definitions.ts
 * (used by the local bundle). This AWS path delegates judgement to the model;
 * normalising arbitrary model output into strictly-typed {@link Finding}s with
 * stable ids, categories, and per-field locations is marked `// FUTURE WIRING`.
 * The thin version invokes the model and maps whatever well-formed findings it
 * returns — it does not silently return `[]` without calling Bedrock.
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";

import type { AppConfig } from "../../config.ts";
import type {
  ExtractedData,
  Finding,
  FindingCategory,
  FindingSeverity,
} from "../../domain/types.ts";
import type { RuleValidator } from "../interfaces.ts";
import {
  AwsProviderError,
  callService,
  resolveAwsSettings,
} from "./aws-common.ts";

const SEVERITIES: ReadonlySet<string> = new Set(["LOW", "MEDIUM", "HIGH"]);
const CATEGORIES: ReadonlySet<string> = new Set([
  "MISSING_FIELD",
  "INCONSISTENCY",
  "COHERENCE",
  "FORMAT",
]);

export class AwsRuleValidator implements RuleValidator {
  private readonly client: BedrockRuntimeClient;
  private readonly modelId: string;

  constructor(config: AppConfig) {
    const settings = resolveAwsSettings(config);
    this.modelId = settings.ruleModelId;
    this.client = new BedrockRuntimeClient({ region: settings.region });
  }

  async validate(extracted: ExtractedData): Promise<Finding[]> {
    const prompt =
      "Eres un validador de estudios previos de adquisicion publica colombiana. " +
      "Analiza los datos extraidos y devuelve EXCLUSIVAMENTE un arreglo JSON de hallazgos. " +
      'Cada hallazgo: {"id","ruleId","severity"(LOW|MEDIUM|HIGH),"category"(MISSING_FIELD|INCONSISTENCY|COHERENCE|FORMAT),"message","evidence","location":{"field"}}.\n\n' +
      `Datos extraidos:\n${JSON.stringify(extracted).slice(0, 8000)}`;

    const response = await callService("bedrock:InvokeModel validate", () =>
      this.client.send(
        new InvokeModelCommand({
          modelId: this.modelId,
          contentType: "application/json",
          accept: "application/json",
          body: JSON.stringify({
            anthropic_version: "bedrock-2023-05-31",
            max_tokens: 4096,
            messages: [{ role: "user", content: prompt }],
          }),
        }),
      ),
    );

    const text = extractClaudeText(response.body);
    return mapFindings(text);
  }
}

/** Decode the Bedrock response bytes and pull the model's text content out. */
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

/**
 * Best-effort mapping of the model's JSON reply into typed findings. Only
 * entries with a valid severity + category are accepted; anything malformed is
 * dropped rather than coerced. // FUTURE WIRING: richer normalisation (stable
 * id scheme, risk-alert derivation, location offsets) once the prompt schema
 * is frozen.
 */
function mapFindings(text: string): Finding[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) {
    return [];
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) {
    return [];
  }

  const findings: Finding[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const f = entry as Record<string, unknown>;
    const severity = String(f.severity ?? "");
    const category = String(f.category ?? "");
    if (!SEVERITIES.has(severity) || !CATEGORIES.has(category)) {
      continue;
    }
    const finding: Finding = {
      id: String(f.id ?? `bedrock-${findings.length + 1}`),
      ruleId: String(f.ruleId ?? "BEDROCK"),
      severity: severity as FindingSeverity,
      category: category as FindingCategory,
      message: String(f.message ?? ""),
      evidence: String(f.evidence ?? ""),
      location: extractLocation(f.location),
    };
    if (finding.severity === "HIGH") {
      finding.riskAlert = { level: "HIGH", reason: finding.message };
    }
    findings.push(finding);
  }
  return findings;
}

function extractLocation(value: unknown): { field?: string } {
  if (typeof value === "object" && value !== null) {
    const field = (value as { field?: unknown }).field;
    if (typeof field === "string") {
      return { field };
    }
  }
  return {};
}
