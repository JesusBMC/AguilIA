/**
 * Upload queue: hands an accepted upload to the worker Lambda through SQS.
 */

import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";

import {
  callService,
  requireConfig,
} from "../providers/aws/aws-common.ts";

/** The message the API sends and the worker consumes. */
export interface UploadMessage {
  documentId: string;
  /** Storage key of the stored upload input (`uploads/<id>/input.json`). */
  inputKey: string;
}

export interface UploadQueue {
  send(message: UploadMessage): Promise<void>;
}

/** SQS-backed {@link UploadQueue} on `AGILIA_QUEUE_URL`. */
export class SqsUploadQueue implements UploadQueue {
  private readonly client: Pick<SQSClient, "send">;
  private readonly queueUrl: string;

  constructor(
    options: { queueUrl: string | undefined; region: string },
    client?: Pick<SQSClient, "send">,
  ) {
    this.queueUrl = requireConfig(options.queueUrl, "AGILIA_QUEUE_URL");
    this.client = client ?? new SQSClient({ region: options.region });
  }

  async send(message: UploadMessage): Promise<void> {
    await callService(`sqs:SendMessage ${message.documentId}`, () =>
      this.client.send(
        new SendMessageCommand({
          QueueUrl: this.queueUrl,
          MessageBody: JSON.stringify(message),
        }),
      ),
    );
  }
}
