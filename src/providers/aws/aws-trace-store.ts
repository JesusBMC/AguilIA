/**
 * Thin DynamoDB-backed {@link TraceStore} implementation.
 *
 * Single-table design on the `agilia-traceability` table (PK/SK), mirroring
 * the item shape the CloudFormation Lambdas write:
 *   - Document record:  PK=`DOC#<id>`  SK=`METADATA`
 *   - Draft version:    PK=`DOC#<id>`  SK=`VERSION#<zero-padded>`
 *   - Decision:         PK=`DOC#<id>`  SK=`DECISION#<id>`
 * Findings are additionally projected into the `agilia-findings` table on
 * save so the findings table stays queryable per the IaC design.
 *
 * The full domain object is stored as a JSON string under a `data` attribute.
 * Per-attribute projection (so DynamoDB can filter/sort on individual fields)
 * is marked `// FUTURE WIRING` — this thin version round-trips the JSON blob.
 */

import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  type AttributeValue,
} from "@aws-sdk/client-dynamodb";
import { randomUUID } from "node:crypto";

import type { AppConfig } from "../../config.ts";
import type {
  Decision,
  DocumentRecord,
  DocumentVersion,
} from "../../domain/types.ts";
import type { DecisionInput, TraceStore } from "../interfaces.ts";
import {
  AwsProviderError,
  callService,
  resolveAwsSettings,
} from "./aws-common.ts";

const METADATA_SK = "METADATA";

export class AwsTraceStore implements TraceStore {
  private readonly client: DynamoDBClient;
  private readonly traceabilityTable: string;
  private readonly findingsTable: string;

  constructor(config: AppConfig) {
    const settings = resolveAwsSettings(config);
    this.traceabilityTable = settings.traceabilityTable;
    this.findingsTable = settings.findingsTable;
    this.client = new DynamoDBClient({ region: settings.region });
  }

  async saveDocument(record: DocumentRecord): Promise<void> {
    await callService(`dynamodb:PutItem ${record.documentId}`, () =>
      this.client.send(
        new PutItemCommand({
          TableName: this.traceabilityTable,
          Item: {
            PK: s(`DOC#${record.documentId}`),
            SK: s(METADATA_SK),
            status: s(record.status),
            updatedAt: s(record.updatedAt),
            data: s(JSON.stringify(record)),
          },
        }),
      ),
    );

    // Project each finding into the findings table. Per-attribute mapping of
    // severity/category for server-side filtering is // FUTURE WIRING; here we
    // store the finding JSON keyed by documentId+findingId.
    for (const finding of record.findings) {
      await callService(`dynamodb:PutItem finding ${finding.id}`, () =>
        this.client.send(
          new PutItemCommand({
            TableName: this.findingsTable,
            Item: {
              documentId: s(record.documentId),
              findingId: s(finding.id),
              severity: s(finding.severity),
              data: s(JSON.stringify(finding)),
            },
          }),
        ),
      );
    }
  }

  async getDocument(documentId: string): Promise<DocumentRecord | null> {
    const result = await callService(`dynamodb:GetItem ${documentId}`, () =>
      this.client.send(
        new GetItemCommand({
          TableName: this.traceabilityTable,
          Key: { PK: s(`DOC#${documentId}`), SK: s(METADATA_SK) },
        }),
      ),
    );
    const raw = result.Item?.data?.S;
    if (!raw) {
      return null;
    }
    return parseJson<DocumentRecord>(raw, `document ${documentId}`);
  }

  async recordDecision(
    documentId: string,
    input: DecisionInput,
  ): Promise<Decision> {
    const decision: Decision = {
      id: randomUUID(),
      findingId: input.findingId,
      action: input.action,
      justification: input.justification,
      recordedAt: new Date().toISOString(),
    };
    await callService(`dynamodb:PutItem decision ${decision.id}`, () =>
      this.client.send(
        new PutItemCommand({
          TableName: this.traceabilityTable,
          Item: {
            PK: s(`DOC#${documentId}`),
            SK: s(`DECISION#${decision.id}`),
            data: s(JSON.stringify(decision)),
          },
        }),
      ),
    );
    return decision;
  }

  async addVersion(
    documentId: string,
    version: Omit<DocumentVersion, "version">,
  ): Promise<DocumentVersion> {
    const existing = await this.listVersions(documentId);
    const nextNumber =
      existing.reduce((max, v) => Math.max(max, v.version), 0) + 1;
    const full: DocumentVersion = { ...version, version: nextNumber };
    await callService(`dynamodb:PutItem version ${nextNumber}`, () =>
      this.client.send(
        new PutItemCommand({
          TableName: this.traceabilityTable,
          Item: {
            PK: s(`DOC#${documentId}`),
            SK: s(`VERSION#${String(nextNumber).padStart(6, "0")}`),
            data: s(JSON.stringify(full)),
          },
        }),
      ),
    );
    return full;
  }

  async listVersions(documentId: string): Promise<DocumentVersion[]> {
    return this.queryByPrefix<DocumentVersion>(
      documentId,
      "VERSION#",
      `versions ${documentId}`,
    );
  }

  async listDecisions(documentId: string): Promise<Decision[]> {
    return this.queryByPrefix<Decision>(
      documentId,
      "DECISION#",
      `decisions ${documentId}`,
    );
  }

  /** Query all items for a document whose SK starts with `skPrefix`. */
  private async queryByPrefix<T>(
    documentId: string,
    skPrefix: string,
    context: string,
  ): Promise<T[]> {
    const result = await callService(`dynamodb:Query ${context}`, () =>
      this.client.send(
        new QueryCommand({
          TableName: this.traceabilityTable,
          KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
          ExpressionAttributeValues: {
            ":pk": s(`DOC#${documentId}`),
            ":sk": s(skPrefix),
          },
        }),
      ),
    );
    const items: T[] = [];
    for (const item of result.Items ?? []) {
      const raw = item.data?.S;
      if (raw) {
        items.push(parseJson<T>(raw, context));
      }
    }
    return items;
  }
}

/** Short-hand for a DynamoDB string attribute value. */
function s(value: string): AttributeValue {
  return { S: value };
}

function parseJson<T>(raw: string, context: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new AwsProviderError(`parse ${context}`, err);
  }
}
