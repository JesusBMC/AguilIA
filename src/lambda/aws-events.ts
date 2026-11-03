/**
 * Domain event publisher on the AgilIA EventBridge custom bus.
 *
 * Events emitted (source `agilia.documents`): DocumentUploaded,
 * DecisionRecorded, DraftReady, ProcessingFailed.
 */

import {
  EventBridgeClient,
  PutEventsCommand,
} from "@aws-sdk/client-eventbridge";

import {
  AwsProviderError,
  callService,
  requireConfig,
} from "../providers/aws/aws-common.ts";

export const EVENT_SOURCE = "agilia.documents";

export interface EventPublisher {
  publish(detailType: string, detail: Record<string, unknown>): Promise<void>;
}

/** EventBridge-backed {@link EventPublisher} on `AGILIA_EVENT_BUS_NAME`. */
export class EventBridgePublisher implements EventPublisher {
  private readonly client: Pick<EventBridgeClient, "send">;
  private readonly busName: string;

  constructor(
    options: { busName: string | undefined; region: string },
    client?: Pick<EventBridgeClient, "send">,
  ) {
    this.busName = requireConfig(options.busName, "AGILIA_EVENT_BUS_NAME");
    this.client = client ?? new EventBridgeClient({ region: options.region });
  }

  async publish(
    detailType: string,
    detail: Record<string, unknown>,
  ): Promise<void> {
    const result = await callService(`events:PutEvents ${detailType}`, () =>
      this.client.send(
        new PutEventsCommand({
          Entries: [
            {
              EventBusName: this.busName,
              Source: EVENT_SOURCE,
              DetailType: detailType,
              Detail: JSON.stringify(detail),
            },
          ],
        }),
      ),
    );
    // PutEvents reports per-entry failures in a 200 response, not as a throw.
    if ((result.FailedEntryCount ?? 0) > 0) {
      const entry = result.Entries?.find((e) => e.ErrorCode);
      throw new AwsProviderError(
        `events:PutEvents ${detailType}`,
        new Error(
          `${result.FailedEntryCount} entry(ies) rejected: ${entry?.ErrorCode ?? "unknown"} ${entry?.ErrorMessage ?? ""}`.trim(),
        ),
      );
    }
  }
}
