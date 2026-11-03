/**
 * Thin OpenSearch-backed {@link SearchIndex} implementation.
 *
 * `index` writes one document per finding into the `agilia-findings` index;
 * `search` runs a multi_match query over message + evidence and maps the hits
 * back to {@link SearchResult}. Advanced relevance tuning (custom analyzers,
 * highlight fragments) is marked `// FUTURE WIRING` — the thin version relies
 * on OpenSearch's default scoring and a trimmed snippet.
 */

import { Client } from "@opensearch-project/opensearch";
import { AwsSigv4Signer } from "@opensearch-project/opensearch/aws-v3";
import { defaultProvider } from "@aws-sdk/credential-provider-node";

import type { AppConfig } from "../../config.ts";
import type { Finding, SearchResult, SourceLocation } from "../../domain/types.ts";
import type { SearchIndex } from "../interfaces.ts";
import { callService, requireConfig, resolveAwsSettings } from "./aws-common.ts";

const INDEX_NAME = "agilia-findings";

interface IndexedFinding {
  documentId: string;
  findingId: string;
  ruleId: string;
  severity: string;
  message: string;
  evidence: string;
  location: SourceLocation;
}

export class AwsSearchIndex implements SearchIndex {
  private readonly client: Client;

  constructor(config: AppConfig) {
    const settings = resolveAwsSettings(config);
    const endpoint = requireConfig(
      settings.openSearchEndpoint,
      "aws.openSearchEndpoint (AWS_OPENSEARCH_ENDPOINT)",
    );
    // The domain only accepts IAM-authenticated requests, so every call is
    // SigV4-signed with the Lambda role credentials from the default chain.
    this.client = new Client({
      ...AwsSigv4Signer({
        region: settings.region,
        service: "es",
        getCredentials: () => defaultProvider()(),
      }),
      node: endpoint,
    });
  }

  async index(findings: Finding[], documentId: string): Promise<void> {
    for (const finding of findings) {
      const body: IndexedFinding = {
        documentId,
        findingId: finding.id,
        ruleId: finding.ruleId,
        severity: finding.severity,
        message: finding.message,
        evidence: finding.evidence,
        location: finding.location,
      };
      await callService(`opensearch:index ${finding.id}`, () =>
        this.client.index({
          index: INDEX_NAME,
          id: `${documentId}::${finding.id}`,
          body,
          refresh: true,
        }),
      );
    }
  }

  async search(query: string): Promise<SearchResult[]> {
    const response = await callService("opensearch:search", () =>
      this.client.search({
        index: INDEX_NAME,
        body: {
          query: {
            multi_match: {
              query,
              fields: ["message", "evidence"],
            },
          },
        },
      }),
    );

    const hits = response.body?.hits?.hits ?? [];
    const results: SearchResult[] = [];
    for (const hit of hits) {
      const source = hit._source as IndexedFinding | undefined;
      if (!source) {
        continue;
      }
      results.push({
        documentId: source.documentId,
        findingId: source.findingId,
        score: typeof hit._score === "number" ? hit._score : 0,
        snippet: source.evidence.slice(0, 200),
        location: source.location,
      });
    }
    return results;
  }
}
