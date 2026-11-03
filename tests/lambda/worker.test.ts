/**
 * Worker Lambda handler tests: SQS batches processed against an isolated
 * local provider bundle and a recording event publisher (no AWS calls).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  createWorkerHandler,
  readMaxReceiveCount,
  type WorkerHandler,
} from "../../src/lambda/worker.ts";
import { createSubmitUpload } from "../../src/lambda/submit-upload.ts";
import type { SqsRecord } from "../../src/lambda/types.ts";
import type { ProviderBundle } from "../../src/providers/interfaces.ts";
import {
  RecordingEvents,
  RecordingQueue,
  SAMPLE,
  buildIsolatedProviders,
} from "./helpers.ts";

const TEST_DIR = resolve(".data", `test-lambda-worker-${randomUUID()}`);

let providers: ProviderBundle;
let queue: RecordingQueue;
let events: RecordingEvents;
let worker: WorkerHandler;

function sqsRecord(body: string, receiveCount = "1"): SqsRecord {
  return {
    messageId: `msg-${randomUUID()}`,
    body,
    attributes: { ApproximateReceiveCount: receiveCount },
  };
}

/** Accept an upload exactly like the API does, returning its queue message. */
async function submit(): Promise<{ documentId: string; inputKey: string }> {
  const submitUpload = createSubmitUpload({ providers, queue, events });
  await submitUpload({ filename: "estudio.txt", text: SAMPLE });
  return queue.sent.at(-1)!;
}

beforeAll(() => {
  providers = buildIsolatedProviders(TEST_DIR);
  queue = new RecordingQueue();
  events = new RecordingEvents();
  worker = createWorkerHandler({ providers, events, maxReceiveCount: 3 });
});

afterAll(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("worker Lambda handler", () => {
  test("processes an upload into a DRAFTED record and publishes DraftReady", async () => {
    const message = await submit();
    const result = await worker({ Records: [sqsRecord(JSON.stringify(message))] });

    expect(result.batchItemFailures).toEqual([]);
    const record = await providers.traceStore.getDocument(message.documentId);
    expect(record?.status).toBe("DRAFTED");
    expect(record?.versions.length).toBeGreaterThanOrEqual(1);
    expect(record?.findings.length).toBeGreaterThanOrEqual(1);
    expect(events.published.at(-1)).toEqual({
      detailType: "DraftReady",
      detail: { documentId: message.documentId, version: 1 },
    });
  });

  test("a missing input key is reported as a batch failure", async () => {
    const documentId = randomUUID();
    const record = sqsRecord(
      JSON.stringify({ documentId, inputKey: `uploads/${documentId}/input.json` }),
    );
    const result = await worker({ Records: [record] });
    expect(result.batchItemFailures).toEqual([{ itemIdentifier: record.messageId }]);
    expect(
      events.published.some((e) => e.detailType === "ProcessingFailed"),
    ).toBe(false);
  });

  test("the last allowed delivery marks the document ERROR and publishes ProcessingFailed", async () => {
    const message = await submit();
    // Simulate a lost input so processing fails on the 3rd delivery.
    const record = sqsRecord(
      JSON.stringify({ ...message, inputKey: `uploads/${message.documentId}/gone.json` }),
      "3",
    );
    const result = await worker({ Records: [record] });

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: record.messageId }]);
    const stored = await providers.traceStore.getDocument(message.documentId);
    expect(stored?.status).toBe("ERROR");
    const failed = events.published.at(-1);
    expect(failed?.detailType).toBe("ProcessingFailed");
    expect(failed?.detail.documentId).toBe(message.documentId);
  });

  test("a malformed message body is reported as a batch failure", async () => {
    const bad = sqsRecord("not json");
    const incomplete = sqsRecord(JSON.stringify({ documentId: "x" }));
    const result = await worker({ Records: [bad, incomplete] });
    expect(result.batchItemFailures).toEqual([
      { itemIdentifier: bad.messageId },
      { itemIdentifier: incomplete.messageId },
    ]);
  });

  test("one failing record does not fail the rest of the batch", async () => {
    const good = await submit();
    const bad = sqsRecord("not json");
    const ok = sqsRecord(JSON.stringify(good));
    const result = await worker({ Records: [bad, ok] });
    expect(result.batchItemFailures).toEqual([{ itemIdentifier: bad.messageId }]);
    expect((await providers.traceStore.getDocument(good.documentId))?.status).toBe(
      "DRAFTED",
    );
  });

  test("a failed DraftReady publish keeps the drafted record and does not retry", async () => {
    const message = await submit();
    events.failWith = new Error("bus unavailable");
    try {
      const result = await worker({ Records: [sqsRecord(JSON.stringify(message))] });
      expect(result.batchItemFailures).toEqual([]);
    } finally {
      events.failWith = undefined;
    }
    const record = await providers.traceStore.getDocument(message.documentId);
    expect(record?.status).toBe("DRAFTED");
    expect(record?.versions.length).toBe(1);
  });

  test("a redelivered message for a drafted document is skipped", async () => {
    const message = await submit();
    await worker({ Records: [sqsRecord(JSON.stringify(message))] });
    const publishedBefore = events.published.length;

    // Even the last allowed delivery must neither rerun nor mark ERROR.
    const result = await worker({ Records: [sqsRecord(JSON.stringify(message), "3")] });

    expect(result.batchItemFailures).toEqual([]);
    const record = await providers.traceStore.getDocument(message.documentId);
    expect(record?.status).toBe("DRAFTED");
    expect(record?.versions.map((v) => v.version)).toEqual([1]);
    expect(events.published.length).toBe(publishedBefore);
  });

  test("submitUpload still answers RECEIVED when DocumentUploaded cannot be published", async () => {
    const submitUpload = createSubmitUpload({ providers, queue, events });
    const queuedBefore = queue.sent.length;
    events.failWith = new Error("bus unavailable");
    let result: Awaited<ReturnType<typeof submitUpload>>;
    try {
      result = await submitUpload({ filename: "estudio.txt", text: SAMPLE });
    } finally {
      events.failWith = undefined;
    }
    expect(result.status).toBe("RECEIVED");
    expect(queue.sent.length).toBe(queuedBefore + 1);
    expect(queue.sent.at(-1)?.documentId).toBe(result.documentId);
    const record = await providers.traceStore.getDocument(result.documentId);
    expect(record?.status).toBe("RECEIVED");
  });

  test("AGILIA_MAX_RECEIVE_COUNT falls back to 3 for invalid values", () => {
    expect(readMaxReceiveCount(undefined)).toBe(3);
    expect(readMaxReceiveCount("abc")).toBe(3);
    expect(readMaxReceiveCount("0")).toBe(3);
    expect(readMaxReceiveCount("5")).toBe(5);
  });
});
