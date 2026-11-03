/**
 * Asynchronous upload submission used by the API Lambda.
 *
 * Instead of running the pipeline inside the API request (API Gateway REST
 * times out at 29 s), the validated upload is stored, a RECEIVED record is
 * saved, and the work is queued for the worker Lambda. Any failing step up to
 * the queue send propagates so the route answers 500 instead of acknowledging
 * a lost upload. The DocumentUploaded event is best effort (logged on failure).
 */

import { randomUUID } from "node:crypto";

import type { ProviderBundle } from "../providers/interfaces.ts";
import { logError } from "../server/errors.ts";
import type { RouteOptions, UploadSubmission } from "../server/routes.ts";
import type { EventPublisher } from "./aws-events.ts";
import type { UploadQueue } from "./aws-queue.ts";

export type SubmitUpload = NonNullable<RouteOptions["submitUpload"]>;

/** Storage key holding the raw upload input for a document. */
export function uploadInputKey(documentId: string): string {
  return `uploads/${documentId}/input.json`;
}

export function createSubmitUpload(deps: {
  providers: ProviderBundle;
  queue: UploadQueue;
  events: EventPublisher;
}): SubmitUpload {
  const { providers, queue, events } = deps;
  return async (input: UploadSubmission) => {
    const documentId = randomUUID();
    const inputKey = uploadInputKey(documentId);
    const now = new Date().toISOString();

    await providers.storage.put(inputKey, JSON.stringify(input));
    await providers.traceStore.saveDocument({
      documentId,
      status: "RECEIVED",
      filename: input.filename,
      findings: [],
      alerts: [],
      versions: [],
      decisions: [],
      createdAt: now,
      updatedAt: now,
    });
    await queue.send({ documentId, inputKey });
    // The work is already queued: a failed announcement must not turn into a
    // 500, or the client would retry and create a duplicate document.
    try {
      await events.publish("DocumentUploaded", { documentId });
    } catch (err) {
      logError(`submitUpload publish DocumentUploaded ${documentId}`, err);
    }

    return { documentId, status: "RECEIVED" };
  };
}
