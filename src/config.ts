/**
 * Runtime configuration, derived from `process.env` with safe defaults.
 *
 * No secret values live here — only non-secret selectors and resource ids.
 * Use `redactForLog` before logging any object that might carry PII or a
 * secret so sensitive values never reach stdout/stderr.
 */

import { resolve } from "node:path";

export type ProviderKind = "local" | "aws";

export interface AppConfig {
  /** Selected provider bundle. Anything other than "aws" resolves to "local". */
  provider: ProviderKind;
  /** HTTP listen port. */
  port: number;
  /** Absolute path to the local runtime data directory. */
  dataDir: string;
  /** AWS resource identifiers (only meaningful when provider === "aws"). */
  aws: {
    region: string;
    bucket?: string;
    documentsTable?: string;
    decisionsTable?: string;
    versionsTable?: string;
    openSearchEndpoint?: string;
  };
}

function readPort(raw: string | undefined): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 8787;
}

function undefinedIfEmpty(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

/** Build the config from the current environment. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const provider: ProviderKind = env.AIDLC_PROVIDER === "aws" ? "aws" : "local";
  return {
    provider,
    port: readPort(env.PORT),
    dataDir: resolve(env.AIDLC_DATA_DIR?.trim() || ".data"),
    aws: {
      region: undefinedIfEmpty(env.AWS_REGION) ?? "us-east-2",
      bucket: undefinedIfEmpty(env.AWS_S3_BUCKET),
      documentsTable: undefinedIfEmpty(env.AWS_DYNAMODB_DOCUMENTS_TABLE),
      decisionsTable: undefinedIfEmpty(env.AWS_DYNAMODB_DECISIONS_TABLE),
      versionsTable: undefinedIfEmpty(env.AWS_DYNAMODB_VERSIONS_TABLE),
      openSearchEndpoint: undefinedIfEmpty(env.AWS_OPENSEARCH_ENDPOINT),
    },
  };
}

/** The process-wide config, resolved once at import time. */
export const config: AppConfig = loadConfig();

/** Case-insensitive fragments of keys whose values must never be logged. */
const SENSITIVE_KEY_FRAGMENTS = [
  "password",
  "secret",
  "token",
  "key",
  "credential",
  "authorization",
  "cdp",
  "entidad",
  "email",
  "nombre",
];

const REDACTION = "[REDACTED]";

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_FRAGMENTS.some((fragment) => lower.includes(fragment));
}

/**
 * Return a deep copy of `value` with sensitive fields replaced by
 * `[REDACTED]`. Use this on anything logged so no PII/secret ever leaks.
 * Handles primitives, arrays, nested objects and cycles.
 */
export function redactForLog<T>(value: T, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (seen.has(value as object)) {
    return "[CIRCULAR]";
  }
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => redactForLog(item, seen));
  }

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSensitiveKey(key) ? REDACTION : redactForLog(val, seen);
  }
  return out;
}
