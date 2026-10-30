/**
 * Thin AWS provider bundle.
 *
 * `src/providers/index.ts` dynamically `import()`s this module only when
 * `AIDLC_PROVIDER=aws`, so the AWS SDK never loads on the local path. Every
 * impl here is wired to a real AWS service (S3, DynamoDB, OpenSearch, Textract,
 * Comprehend, Bedrock), constructs its client from config/env, and handles SDK
 * errors. Incomplete response mapping is flagged `// FUTURE WIRING` in each
 * file rather than hidden behind a silent no-op.
 */

import type { AppConfig } from "../../config.ts";
import type { ProviderBundle } from "../interfaces.ts";
import { AwsDocumentExtractor } from "./aws-document-extractor.ts";
import { AwsNlpAnalyzer } from "./aws-nlp-analyzer.ts";
import { AwsRuleValidator } from "./aws-rule-validator.ts";
import { AwsDraftGenerator } from "./aws-draft-generator.ts";
import { AwsStorage } from "./aws-storage.ts";
import { AwsTraceStore } from "./aws-trace-store.ts";
import { AwsSearchIndex } from "./aws-search-index.ts";

/**
 * Assemble the AWS {@link ProviderBundle} for the given config. Clients are
 * constructed eagerly (cheap — no network call until a method runs) so any
 * missing required configuration surfaces immediately as an AwsConfigError.
 */
export function buildAwsProviders(config: AppConfig): ProviderBundle {
  return {
    documentExtractor: new AwsDocumentExtractor(config),
    nlpAnalyzer: new AwsNlpAnalyzer(config),
    ruleValidator: new AwsRuleValidator(config),
    draftGenerator: new AwsDraftGenerator(config),
    storage: new AwsStorage(config),
    traceStore: new AwsTraceStore(config),
    searchIndex: new AwsSearchIndex(config),
  };
}
