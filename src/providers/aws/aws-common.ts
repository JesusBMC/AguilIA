/**
 * Shared helpers for the thin AWS provider bundle.
 *
 * These impls are deliberately *thin*: every method constructs its SDK client
 * from config/env (never hardcoded secrets), calls the real service, and wraps
 * SDK failures in a descriptive error so nothing fails silently. Response
 * mapping is minimal; anywhere the mapping is not yet complete is marked with
 * an explicit `// FUTURE WIRING` comment rather than a silent no-op.
 */

import type { AppConfig } from "../../config.ts";

/** Thrown when a required AWS resource identifier is absent from config/env. */
export class AwsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AwsConfigError";
  }
}

/** Wraps any thrown SDK/runtime value in a provider-scoped error. */
export class AwsProviderError extends Error {
  readonly cause?: unknown;
  constructor(operation: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`aws provider: ${operation} failed: ${detail}`);
    this.name = "AwsProviderError";
    this.cause = cause;
  }
}

/** Run an SDK call, re-throwing failures as an {@link AwsProviderError}. */
export async function callService<T>(
  operation: string,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw new AwsProviderError(operation, err);
  }
}

/** Return `value` or throw an {@link AwsConfigError} naming what is missing. */
export function requireConfig(
  value: string | undefined,
  what: string,
): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new AwsConfigError(
      `aws provider: missing required configuration "${what}" (set it via config/env)`,
    );
  }
  return trimmed;
}

/** Resolved, non-secret settings the AWS bundle needs. */
export interface AwsSettings {
  region: string;
  bucket?: string;
  traceabilityTable: string;
  findingsTable: string;
  openSearchEndpoint?: string;
  ruleModelId: string;
  draftModelId: string;
  comprehendLanguage: string;
}

/**
 * Derive AWS settings from the resolved {@link AppConfig} plus a few
 * non-secret, model-specific env overrides. Table names fall back to the
 * CloudFormation defaults in `iac/template.yaml`.
 */
export function resolveAwsSettings(
  config: AppConfig,
  env: NodeJS.ProcessEnv = process.env,
): AwsSettings {
  return {
    region: config.aws.region,
    bucket: config.aws.bucket,
    traceabilityTable:
      config.aws.documentsTable?.trim() ||
      env.AWS_DYNAMODB_TRACEABILITY_TABLE?.trim() ||
      "agilia-traceability-dev",
    findingsTable:
      env.AWS_DYNAMODB_FINDINGS_TABLE?.trim() || "agilia-findings-dev",
    openSearchEndpoint: config.aws.openSearchEndpoint,
    ruleModelId:
      env.AWS_BEDROCK_RULE_MODEL_ID?.trim() || "us.anthropic.claude-opus-5-5",
    draftModelId:
      env.AWS_BEDROCK_DRAFT_MODEL_ID?.trim() || "us.anthropic.claude-opus-5-5",
    comprehendLanguage: env.AWS_COMPREHEND_LANGUAGE?.trim() || "es",
  };
}
