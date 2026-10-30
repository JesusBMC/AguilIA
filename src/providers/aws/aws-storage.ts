/**
 * Thin S3-backed {@link Storage} implementation.
 *
 * Keys map 1:1 to S3 object keys inside the configured documents bucket.
 * A missing object resolves to `null` (never an error), matching the local
 * provider's contract.
 */

import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import type { AppConfig } from "../../config.ts";
import type { Storage } from "../interfaces.ts";
import {
  AwsProviderError,
  callService,
  requireConfig,
  resolveAwsSettings,
} from "./aws-common.ts";

export class AwsStorage implements Storage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: AppConfig) {
    const settings = resolveAwsSettings(config);
    this.bucket = requireConfig(settings.bucket, "aws.bucket (AWS_S3_BUCKET)");
    this.client = new S3Client({ region: settings.region });
  }

  async put(key: string, value: string): Promise<void> {
    await callService(`s3:PutObject ${key}`, () =>
      this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: value,
          ContentType: "application/octet-stream",
          ServerSideEncryption: "AES256",
        }),
      ),
    );
  }

  async get(key: string): Promise<string | null> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!response.Body) {
        return null;
      }
      // The SDK stream exposes transformToString() in Node/Bun runtimes.
      return await response.Body.transformToString();
    } catch (err) {
      if (isNotFound(err)) {
        return null;
      }
      throw new AwsProviderError(`s3:GetObject ${key}`, err);
    }
  }

  async list(prefix?: string): Promise<string[]> {
    const keys: string[] = [];
    let continuationToken: string | undefined;
    do {
      const page = await callService("s3:ListObjectsV2", () =>
        this.client.send(
          new ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken,
          }),
        ),
      );
      for (const object of page.Contents ?? []) {
        if (object.Key) {
          keys.push(object.Key);
        }
      }
      continuationToken = page.IsTruncated
        ? page.NextContinuationToken
        : undefined;
    } while (continuationToken);
    return keys;
  }
}

/** True when an S3 error signals an absent key, so `get` can return null. */
function isNotFound(err: unknown): boolean {
  if (typeof err !== "object" || err === null) {
    return false;
  }
  const name = (err as { name?: string }).name;
  const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata
    ?.httpStatusCode;
  return name === "NoSuchKey" || name === "NotFound" || status === 404;
}
