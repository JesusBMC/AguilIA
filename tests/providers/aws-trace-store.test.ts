/**
 * AwsTraceStore tests with a fake DynamoDB client: `send()` answers by the
 * command class name, so no network or credentials are involved.
 */

import { describe, expect, test } from "bun:test";
import type { AttributeValue } from "@aws-sdk/client-dynamodb";
import { loadConfig } from "../../src/config.ts";
import { AwsProviderError } from "../../src/providers/aws/aws-common.ts";
import {
  AwsTraceStore,
  type DynamoSender,
} from "../../src/providers/aws/aws-trace-store.ts";
import type { Decision, DocumentRecord, DocumentVersion } from "../../src/domain/types.ts";

type Item = Record<string, AttributeValue>;
interface FakeCommand {
  constructor: { name: string };
  input: {
    Item?: Item;
    ExpressionAttributeValues?: Item;
  };
}

const config = loadConfig({ AIDLC_PROVIDER: "aws", AWS_REGION: "us-east-2" });

const metadata: DocumentRecord = {
  documentId: "doc-1",
  status: "DRAFTED",
  filename: "estudio.txt",
  findings: [],
  alerts: [],
  versions: [],
  decisions: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const versions: DocumentVersion[] = [
  { version: 2, createdAt: "2026-01-03T00:00:00.000Z", storageKey: "drafts/doc-1/v2.md" },
  { version: 1, createdAt: "2026-01-02T00:00:00.000Z", storageKey: "drafts/doc-1/draft.md" },
];

const decisions: Decision[] = [
  {
    id: "d-2",
    findingId: "f-1",
    action: "REJECT",
    justification: "No aplica",
    recordedAt: "2026-01-05T00:00:00.000Z",
  },
  {
    id: "d-1",
    findingId: "f-1",
    action: "ACCEPT",
    justification: "",
    recordedAt: "2026-01-04T00:00:00.000Z",
  },
];

function asItems(values: unknown[]): Item[] {
  return values.map((v) => ({ data: { S: JSON.stringify(v) } }));
}

/** A fake client; `metadataItem: null` simulates a missing document. */
function fakeClient(options: {
  metadataItem?: Item | null;
  fail?: Error;
  sent?: FakeCommand[];
}): DynamoSender {
  const send = async (command: FakeCommand) => {
    options.sent?.push(command);
    if (options.fail) {
      throw options.fail;
    }
    switch (command.constructor.name) {
      case "GetItemCommand":
        return options.metadataItem === null
          ? {}
          : { Item: options.metadataItem ?? { data: { S: JSON.stringify(metadata) } } };
      case "QueryCommand": {
        const prefix = command.input.ExpressionAttributeValues?.[":sk"]?.S;
        if (prefix === "VERSION#") return { Items: asItems(versions) };
        if (prefix === "DECISION#") return { Items: asItems(decisions) };
        return { Items: [] };
      }
      case "PutItemCommand":
        return {};
      default:
        throw new Error(`unexpected command ${command.constructor.name}`);
    }
  };
  return { send } as unknown as DynamoSender;
}

describe("AwsTraceStore (fake DynamoDB)", () => {
  test("getDocument merges versions and decisions in order", async () => {
    const store = new AwsTraceStore(config, fakeClient({}));
    const record = await store.getDocument("doc-1");
    expect(record?.documentId).toBe("doc-1");
    expect(record?.versions.map((v) => v.version)).toEqual([1, 2]);
    expect(record?.decisions.map((d) => d.id)).toEqual(["d-1", "d-2"]);
  });

  test("getDocument returns null for a missing item", async () => {
    const store = new AwsTraceStore(config, fakeClient({ metadataItem: null }));
    expect(await store.getDocument("missing")).toBeNull();
  });

  test("a service error surfaces as AwsProviderError", async () => {
    const store = new AwsTraceStore(
      config,
      fakeClient({ fail: new Error("ProvisionedThroughputExceeded") }),
    );
    const error = await store.getDocument("doc-1").catch((err: unknown) => err);
    expect(error).toBeInstanceOf(AwsProviderError);
    expect((error as Error).message).toContain("ProvisionedThroughputExceeded");
  });

  test("a corrupt METADATA blob surfaces as AwsProviderError", async () => {
    const store = new AwsTraceStore(
      config,
      fakeClient({ metadataItem: { data: { S: "{not json" } } }),
    );
    await expect(store.getDocument("doc-1")).rejects.toBeInstanceOf(AwsProviderError);
  });

  test("recordDecision stores recordedBy and the USER# GSI1 keys", async () => {
    const sent: FakeCommand[] = [];
    const store = new AwsTraceStore(config, fakeClient({ sent }));
    const decision = await store.recordDecision("doc-1", {
      findingId: "f-1",
      action: "ACCEPT",
      justification: "",
      recordedBy: "user-123",
    });
    expect(decision.recordedBy).toBe("user-123");
    const item = sent.at(-1)?.input.Item;
    expect(item?.recordedBy?.S).toBe("user-123");
    expect(item?.GSI1PK?.S).toBe("USER#user-123");
    expect(item?.GSI1SK?.S).toBe(decision.recordedAt);
  });

  test("recordDecision without an actor writes no GSI1 keys", async () => {
    const sent: FakeCommand[] = [];
    const store = new AwsTraceStore(config, fakeClient({ sent }));
    const decision = await store.recordDecision("doc-1", {
      findingId: "f-1",
      action: "ACCEPT",
      justification: "",
    });
    expect("recordedBy" in decision).toBe(false);
    const item = sent.at(-1)?.input.Item;
    expect(item?.GSI1PK).toBeUndefined();
    expect(item?.recordedBy).toBeUndefined();
  });
});
