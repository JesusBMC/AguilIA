/**
 * API Lambda handler tests: the Hono app wrapped by hono/aws-lambda, invoked
 * with synthetic API Gateway REST (v1) events. Providers are isolated local
 * bundles; the SQS queue and EventBridge bus are recording fakes, so no AWS
 * call is ever made.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createApiHandler } from "../../src/lambda/api.ts";
import { createSubmitUpload } from "../../src/lambda/submit-upload.ts";
import type { ProviderBundle } from "../../src/providers/interfaces.ts";
import {
  RecordingEvents,
  RecordingQueue,
  SAMPLE,
  buildIsolatedProviders,
  restEvent,
} from "./helpers.ts";

const TEST_DIR = resolve(".data", `test-lambda-api-${randomUUID()}`);

type Invoke = (event: unknown) => Promise<{ statusCode: number; body: string }>;

let providers: ProviderBundle;
let queue: RecordingQueue;
let events: RecordingEvents;
let invoke: Invoke;

beforeAll(() => {
  providers = buildIsolatedProviders(TEST_DIR);
  queue = new RecordingQueue();
  events = new RecordingEvents();
  const handler = createApiHandler({
    providers,
    submitUpload: createSubmitUpload({ providers, queue, events }),
    onEvent: (detailType, detail) => events.publish(detailType, detail),
  });
  invoke = handler as unknown as Invoke;
});

afterAll(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

async function uploadAsync(path: string): Promise<string> {
  const res = await invoke(
    restEvent({
      method: "POST",
      path,
      body: { filename: "estudio.txt", text: SAMPLE },
      sub: "user-123",
    }),
  );
  expect(res.statusCode).toBe(202);
  const body = JSON.parse(res.body) as { documentId: string; status: string };
  expect(body.status).toBe("RECEIVED");
  return body.documentId;
}

describe("API Lambda handler", () => {
  test("GET /health returns 200 and reports cognito auth", async () => {
    const res = await invoke(restEvent({ method: "GET", path: "/health" }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: "ok", auth: "cognito" });
  });

  test("POST /documents/upload returns 202, stores the input and queues it", async () => {
    const before = queue.sent.length;
    const documentId = await uploadAsync("/documents/upload");

    expect(queue.sent.length).toBe(before + 1);
    const message = queue.sent.at(-1)!;
    expect(message).toEqual({
      documentId,
      inputKey: `uploads/${documentId}/input.json`,
    });

    const stored = await providers.storage.get(message.inputKey);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!)).toMatchObject({
      filename: "estudio.txt",
      text: SAMPLE,
    });

    const record = await providers.traceStore.getDocument(documentId);
    expect(record?.status).toBe("RECEIVED");
    expect(
      events.published.some(
        (e) =>
          e.detailType === "DocumentUploaded" &&
          e.detail.documentId === documentId,
      ),
    ).toBe(true);
  });

  test("POST /documents (API Gateway alias) also returns 202", async () => {
    const documentId = await uploadAsync("/documents");
    expect(queue.sent.at(-1)?.documentId).toBe(documentId);
  });

  test("an invalid upload body returns 400 and queues nothing", async () => {
    const before = queue.sent.length;
    const res = await invoke(
      restEvent({ method: "POST", path: "/documents/upload", body: { text: SAMPLE } }),
    );
    expect(res.statusCode).toBe(400);
    expect((JSON.parse(res.body) as { error: { code: string } }).error.code).toBe(
      "VALIDATION",
    );
    expect(queue.sent.length).toBe(before);
  });

  test("a decision records the Cognito sub as recordedBy and emits DecisionRecorded", async () => {
    const documentId = await uploadAsync("/documents/upload");
    const res = await invoke(
      restEvent({
        method: "POST",
        path: `/documents/${documentId}/decision`,
        body: { findingId: "finding-1", action: "ACCEPT" },
        sub: "user-123",
      }),
    );
    expect(res.statusCode).toBe(200);
    const { decisionId } = JSON.parse(res.body) as { decisionId: string };

    const decisions = await providers.traceStore.listDecisions(documentId);
    const decision = decisions.find((d) => d.id === decisionId);
    expect(decision?.recordedBy).toBe("user-123");
    expect(events.published.at(-1)).toEqual({
      detailType: "DecisionRecorded",
      detail: { documentId, decisionId, findingId: "finding-1", action: "ACCEPT" },
    });
  });

  test("a decision without an authorizer omits recordedBy", async () => {
    const documentId = await uploadAsync("/documents/upload");
    const res = await invoke(
      restEvent({
        method: "POST",
        path: `/documents/${documentId}/decision`,
        body: { findingId: "finding-2", action: "ACCEPT" },
      }),
    );
    expect(res.statusCode).toBe(200);
    const [decision] = await providers.traceStore.listDecisions(documentId);
    expect(decision).toBeDefined();
    expect("recordedBy" in decision!).toBe(false);
  });

  test("a failing event publish does not fail an already-recorded decision", async () => {
    const documentId = await uploadAsync("/documents/upload");
    events.failWith = new Error("bus unavailable");
    try {
      const res = await invoke(
        restEvent({
          method: "POST",
          path: `/documents/${documentId}/decision`,
          body: { findingId: "finding-3", action: "ACCEPT" },
          sub: "user-123",
        }),
      );
      expect(res.statusCode).toBe(200);
      expect((await providers.traceStore.listDecisions(documentId)).length).toBe(1);
    } finally {
      events.failWith = undefined;
    }
  });

  test("a failing queue turns the upload into a 500 without leaking detail", async () => {
    const failingProviders = buildIsolatedProviders(resolve(TEST_DIR, "failing"));
    const handler = createApiHandler({
      providers: failingProviders,
      submitUpload: createSubmitUpload({
        providers: failingProviders,
        queue: {
          send: async () => {
            throw new Error("sqs down: secret-internal-detail");
          },
        },
        events,
      }),
    }) as unknown as Invoke;
    const res = await handler(
      restEvent({
        method: "POST",
        path: "/documents/upload",
        body: { filename: "estudio.txt", text: SAMPLE },
      }),
    );
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain("secret-internal-detail");
  });
});
