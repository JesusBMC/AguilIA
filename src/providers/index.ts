/**
 * Provider selector.
 *
 * `buildLocalProviders()` assembles the fully-offline local bundle (no network,
 * no AWS SDK). `getProviders()` returns that bundle unless the resolved config
 * selects `aws`, in which case it dynamically `import()`s the thin AWS bundle
 * (added in FEAT-004). The dynamic import keeps the AWS SDK out of the local
 * runtime entirely — the local path never loads `./aws/index.ts`.
 */

import { config as defaultConfig, type AppConfig } from "../config.ts";
import type { ProviderBundle } from "./interfaces.ts";
import { LocalDocumentExtractor } from "./local/local-document-extractor.ts";
import { LocalNlpAnalyzer } from "./local/local-nlp-analyzer.ts";
import { LocalRuleValidator } from "./local/local-rule-validator.ts";
import { LocalDraftGenerator } from "./local/local-draft-generator.ts";
import { LocalStorage } from "./local/local-storage.ts";
import { LocalTraceStore } from "./local/local-trace-store.ts";
import { LocalSearchIndex } from "./local/local-search-index.ts";

/** Build the local provider bundle. Synchronous; no I/O until a method runs. */
export function buildLocalProviders(): ProviderBundle {
  return {
    documentExtractor: new LocalDocumentExtractor(),
    nlpAnalyzer: new LocalNlpAnalyzer(),
    ruleValidator: new LocalRuleValidator(),
    draftGenerator: new LocalDraftGenerator(),
    storage: new LocalStorage(),
    traceStore: new LocalTraceStore(),
    searchIndex: new LocalSearchIndex(),
  };
}

/**
 * Resolve the active provider bundle for the given config.
 *
 * For `local` this is synchronous work wrapped in a promise. For `aws` the AWS
 * module is loaded lazily via a non-literal `import()` specifier so TypeScript
 * does not hard-require the (not-yet-present) module at compile time and the
 * local runtime never touches it.
 */
export async function getProviders(
  config: AppConfig = defaultConfig,
): Promise<ProviderBundle> {
  if (config.provider !== "aws") {
    return buildLocalProviders();
  }

  // Non-literal specifier: resolved only at runtime when AIDLC_PROVIDER=aws.
  const awsModulePath = "./aws/index.ts";
  try {
    const mod: { buildAwsProviders?: (config: AppConfig) => ProviderBundle } =
      await import(awsModulePath);
    if (typeof mod.buildAwsProviders !== "function") {
      throw new Error("aws module does not export buildAwsProviders()");
    }
    return mod.buildAwsProviders(config);
  } catch (err) {
    throw new Error(
      `getProviders: AWS provider bundle is unavailable (expected ./aws/index.ts from FEAT-004): ${(err as Error).message}`,
    );
  }
}
