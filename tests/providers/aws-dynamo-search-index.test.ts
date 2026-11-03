/**
 * DynamoFindingsSearchIndex tests with a fake, paginated DynamoDB Scan.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { AttributeValue } from "@aws-sdk/client-dynamodb";
import { loadConfig } from "../../src/config.ts";
import { AwsProviderError } from "../../src/providers/aws/aws-common.ts";
import {
  DynamoFindingsSearchIndex,
  type DynamoScanSender,
} from "../../src/providers/aws/aws-dynamo-search-index.ts";
import type { Finding } from "../../src/domain/types.ts";

type Item = Record<string, AttributeValue>;

const config = loadConfig({ AIDLC_PROVIDER: "aws", AWS_REGION: "us-east-2" });

function finding(id: string, message: string, evidence: string): Finding {
  return {
    id,
    ruleId: `RULE-${id}`,
    severity: "HIGH",
    category: "INCONSISTENCY",
    message,
    evidence,
    location: { line: 1 },
  };
}

function item(documentId: string, f: Finding): Item {
  return {
    documentId: { S: documentId },
    findingId: { S: f.id },
    data: { S: JSON.stringify(f) },
  };
}

const PAGE_1: Item[] = [
  item("doc-a", finding("f1", "El valor del CDP no coincide", "CDP No. 40626")),
  // Malformed row: must be skipped, never break the search.
  { documentId: { S: "doc-a" }, findingId: { S: "bad" }, data: { S: "{oops" } },
];
const PAGE_2: Item[] = [
  item("doc-b", finding("f2", "Marca cerrada detectada", "Marca: Apple")),
  item("doc-b", finding("f3", "Plazo de ejecucion ausente", "Plazo")),
];

/** Fake client that serves two Scan pages and records each request. */
function pagedClient(calls: { ExclusiveStartKey?: Item }[]): DynamoScanSender {
  const send = async (command: { input: { ExclusiveStartKey?: Item } }) => {
    calls.push({ ExclusiveStartKey: command.input.ExclusiveStartKey });
    if (!command.input.ExclusiveStartKey) {
      return { Items: PAGE_1, LastEvaluatedKey: { documentId: { S: "doc-a" } } };
    }
    return { Items: PAGE_2 };
  };
  return { send } as unknown as DynamoScanSender;
}

let warnSpy: ReturnType<typeof spyOn>;
beforeEach(() => {
  warnSpy = spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warnSpy.mockRestore();
});

describe("DynamoFindingsSearchIndex (fake Scan)", () => {
  test("scans every page and returns ranked results for a matching term", async () => {
    const calls: { ExclusiveStartKey?: Item }[] = [];
    const index = new DynamoFindingsSearchIndex(config, pagedClient(calls));
    const results = await index.search("marca apple");

    expect(calls.length).toBe(2);
    expect(calls[1]?.ExclusiveStartKey).toEqual({ documentId: { S: "doc-a" } });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]).toMatchObject({ documentId: "doc-b", findingId: "f2" });
  });

  test("returns an empty array when nothing matches", async () => {
    const index = new DynamoFindingsSearchIndex(config, pagedClient([]));
    expect(await index.search("inexistente")).toEqual([]);
  });

  test("skips a malformed row with a counted warning", async () => {
    const index = new DynamoFindingsSearchIndex(config, pagedClient([]));
    const results = await index.search("cdp");
    expect(results.map((r) => r.findingId)).toEqual(["f1"]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain("skipped 1 malformed");
  });

  test("a Scan failure surfaces as AwsProviderError", async () => {
    const client = {
      send: async () => {
        throw new Error("AccessDeniedException");
      },
    } as unknown as DynamoScanSender;
    const index = new DynamoFindingsSearchIndex(config, client);
    await expect(index.search("cdp")).rejects.toBeInstanceOf(AwsProviderError);
  });

  test("index() is a no-op that never calls DynamoDB", async () => {
    const calls: { ExclusiveStartKey?: Item }[] = [];
    const index = new DynamoFindingsSearchIndex(config, pagedClient(calls));
    await index.index([finding("f9", "x", "y")], "doc-z");
    expect(calls.length).toBe(0);
  });
});
