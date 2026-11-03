/**
 * Minimal local typings for the Lambda events this repo handles.
 *
 * Only the fields the handlers read are declared, so the project does not
 * need `@types/aws-lambda`.
 */

/** One SQS message delivered to a Lambda through an event source mapping. */
export interface SqsRecord {
  messageId: string;
  body: string;
  attributes: {
    /** How many times SQS has delivered this message (string-encoded int). */
    ApproximateReceiveCount: string;
  };
}

/** The SQS batch event. */
export interface SqsEvent {
  Records: SqsRecord[];
}

/** Partial batch response (requires `ReportBatchItemFailures` on the mapping). */
export interface SqsBatchResponse {
  batchItemFailures: { itemIdentifier: string }[];
}
