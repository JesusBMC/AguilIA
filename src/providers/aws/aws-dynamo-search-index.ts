/**
 * DynamoDB-backed {@link SearchIndex} fallback, used when OpenSearch is
 * disabled (`AWS_SEARCH_BACKEND=dynamodb`, the default).
 *
 * `search` scans the findings table (paginated), loads every finding into a
 * fresh in-memory {@link LocalSearchIndex} and returns its BM25 ranking. A
 * full scan per query is acceptable at MVP volume; switch to OpenSearch when
 * the findings table grows.
 */

import {
  DynamoDBClient,
  ScanCommand,
  type AttributeValue,
} from "@aws-sdk/client-dynamodb";

import type { AppConfig } from "../../config.ts";
import type { Finding, SearchResult } from "../../domain/types.ts";
import type { SearchIndex } from "../interfaces.ts";
import { LocalSearchIndex } from "../local/local-search-index.ts";
import { callService, resolveAwsSettings } from "./aws-common.ts";

/** The slice of the DynamoDB client this index uses (injectable for tests). */
export type DynamoScanSender = Pick<DynamoDBClient, "send">;

export class DynamoFindingsSearchIndex implements SearchIndex {
  private readonly client: DynamoScanSender;
  private readonly findingsTable: string;

  constructor(config: AppConfig, client?: DynamoScanSender) {
    const settings = resolveAwsSettings(config);
    this.findingsTable = settings.findingsTable;
    this.client = client ?? new DynamoDBClient({ region: settings.region });
  }

  /**
   * No-op by design: `AwsTraceStore.saveDocument` already projects every
   * finding into the findings table, which is what `search` scans.
   */
  async index(_findings: Finding[], _documentId: string): Promise<void> {
    return;
  }

  async search(query: string): Promise<SearchResult[]> {
    const byDocument = new Map<string, Finding[]>();
    let malformed = 0;
    let startKey: Record<string, AttributeValue> | undefined;

    do {
      const page = await callService("dynamodb:Scan findings", () =>
        this.client.send(
          new ScanCommand({
            TableName: this.findingsTable,
            ExclusiveStartKey: startKey,
          }),
        ),
      );
      for (const item of page.Items ?? []) {
        const documentId = item.documentId?.S;
        const finding = parseFinding(item.data?.S);
        if (!documentId || !finding) {
          malformed++;
          continue;
        }
        const list = byDocument.get(documentId) ?? [];
        list.push(finding);
        byDocument.set(documentId, list);
      }
      startKey = page.LastEvaluatedKey;
    } while (startKey);

    if (malformed > 0) {
      console.warn(
        `[agilia] DynamoFindingsSearchIndex: skipped ${malformed} malformed finding item(s)`,
      );
    }

    const local = new LocalSearchIndex();
    for (const [documentId, findings] of byDocument) {
      await local.index(findings, documentId);
    }
    return local.search(query);
  }
}

/** Parse a stored finding blob; returns null for anything unusable. */
function parseFinding(raw: string | undefined): Finding | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Finding> | null;
    if (!parsed || typeof parsed !== "object" || typeof parsed.id !== "string") {
      return null;
    }
    return parsed as Finding;
  } catch {
    return null;
  }
}
