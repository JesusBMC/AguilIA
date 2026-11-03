/**
 * Worker Lambda entry point (`agilia-worker-<env>`, handler `index.handler`).
 *
 * Triggered by the processing SQS queue (batch size 1, partial batch
 * responses). For each message it loads the stored upload input, runs the
 * full pipeline with the AWS provider bundle and publishes `DraftReady`.
 * Failures are reported per message so SQS retries them; on the last allowed
 * delivery the document is marked ERROR and `ProcessingFailed` is published
 * before the message moves to the DLQ. Document text is never logged.
 */

import { loadConfig, redactForLog } from "../config.ts";
import { runPipeline } from "../pipeline/pipeline.ts";
import { buildAwsProviders } from "../providers/aws/index.ts";
import type { ProviderBundle } from "../providers/interfaces.ts";
import { parseUploadBody } from "../server/schemas.ts";
import { EventBridgePublisher, type EventPublisher } from "./aws-events.ts";
import type { UploadMessage } from "./aws-queue.ts";
import type { SqsBatchResponse, SqsEvent, SqsRecord } from "./types.ts";

export type WorkerHandler = (event: SqsEvent) => Promise<SqsBatchResponse>;

/** Default SQS redrive maxReceiveCount (matches the Terraform queue). */
export const DEFAULT_MAX_RECEIVE_COUNT = 3;

/** Thrown for a message that can never succeed (bad body / missing input). */
class MessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MessageError";
  }
}

function parseMessage(body: string): UploadMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new MessageError("message body is not valid JSON");
  }
  const candidate = parsed as Partial<UploadMessage> | null;
  if (
    !candidate ||
    typeof candidate !== "object" ||
    typeof candidate.documentId !== "string" ||
    candidate.documentId.trim() === "" ||
    typeof candidate.inputKey !== "string" ||
    candidate.inputKey.trim() === ""
  ) {
    throw new MessageError("message body must carry documentId and inputKey");
  }
  return { documentId: candidate.documentId, inputKey: candidate.inputKey };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function logWorker(context: string, meta: Record<string, unknown>): void {
  console.error(`[agilia] worker ${context}`, JSON.stringify(redactForLog(meta)));
}

export function createWorkerHandler(deps: {
  providers: ProviderBundle;
  events: EventPublisher;
  maxReceiveCount: number;
}): WorkerHandler {
  const { providers, events, maxReceiveCount } = deps;

  /** Load the upload input, run the pipeline and announce the draft. */
  async function processMessage(message: UploadMessage): Promise<void> {
    // SQS delivers at least once: a redelivered message for a finished
    // document must not rerun Bedrock or add a second draft version.
    const existing = await providers.traceStore.getDocument(message.documentId);
    if (existing && existing.status === "DRAFTED" && existing.versions.length > 0) {
      logWorker("skipped: document already drafted", {
        documentId: message.documentId,
      });
      return;
    }

    const raw = await providers.storage.get(message.inputKey);
    if (raw === null) {
      throw new MessageError(`upload input not found at ${message.inputKey}`);
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new MessageError(`upload input at ${message.inputKey} is not valid JSON`);
    }
    const input = parseUploadBody(json);
    if (!input.ok) {
      throw new MessageError(`upload input at ${message.inputKey} is invalid`);
    }

    const record = await runPipeline(
      { ...input.data, documentId: message.documentId },
      providers,
    );
    const version = record.versions.reduce((max, v) => Math.max(max, v.version), 0);
    // The draft is already persisted: a failed announcement is logged, never
    // retried through SQS (that would rerun the whole pipeline).
    try {
      await events.publish("DraftReady", {
        documentId: message.documentId,
        version,
      });
    } catch (err) {
      logWorker("publish DraftReady failed", {
        documentId: message.documentId,
        error: errorMessage(err),
      });
    }
  }

  /** Last delivery: persist the ERROR status and announce the failure. */
  async function markFailed(documentId: string, reason: string): Promise<void> {
    try {
      const existing = await providers.traceStore.getDocument(documentId);
      const now = new Date().toISOString();
      await providers.traceStore.saveDocument(
        existing
          ? { ...existing, status: "ERROR", updatedAt: now }
          : {
              documentId,
              status: "ERROR",
              findings: [],
              alerts: [],
              versions: [],
              decisions: [],
              createdAt: now,
              updatedAt: now,
            },
      );
    } catch (err) {
      logWorker("mark ERROR failed", { documentId, error: errorMessage(err) });
    }
    try {
      await events.publish("ProcessingFailed", { documentId, reason });
    } catch (err) {
      logWorker("publish ProcessingFailed failed", {
        documentId,
        error: errorMessage(err),
      });
    }
  }

  async function handleRecord(record: SqsRecord): Promise<boolean> {
    let message: UploadMessage | undefined;
    try {
      message = parseMessage(record.body);
      await processMessage(message);
      return true;
    } catch (err) {
      const receiveCount = Number(record.attributes?.ApproximateReceiveCount);
      logWorker("processing failed", {
        messageId: record.messageId,
        documentId: message?.documentId,
        receiveCount,
        error: errorMessage(err),
      });
      if (message && Number.isFinite(receiveCount) && receiveCount >= maxReceiveCount) {
        await markFailed(message.documentId, errorMessage(err));
      }
      return false;
    }
  }

  return async (event: SqsEvent): Promise<SqsBatchResponse> => {
    const batchItemFailures: SqsBatchResponse["batchItemFailures"] = [];
    for (const record of event.Records ?? []) {
      const ok = await handleRecord(record);
      if (!ok) {
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures };
  };
}

/** Parse AGILIA_MAX_RECEIVE_COUNT; anything not a positive integer => default. */
export function readMaxReceiveCount(raw: string | undefined): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_RECEIVE_COUNT;
}

function createWorkerHandlerFromEnv(env: NodeJS.ProcessEnv): WorkerHandler {
  const config = loadConfig(env);
  return createWorkerHandler({
    providers: buildAwsProviders(config),
    events: new EventBridgePublisher({
      busName: env.AGILIA_EVENT_BUS_NAME,
      region: config.aws.region,
    }),
    maxReceiveCount: readMaxReceiveCount(env.AGILIA_MAX_RECEIVE_COUNT),
  });
}

let cachedHandler: WorkerHandler | undefined;

/** Lambda handler: built once per execution environment, on first use. */
export const handler: WorkerHandler = (event) => {
  cachedHandler ??= createWorkerHandlerFromEnv(process.env);
  return cachedHandler(event);
};
