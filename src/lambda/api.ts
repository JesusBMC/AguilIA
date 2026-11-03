/**
 * API Lambda entry point (`agilia-api-<env>`, handler `index.handler`).
 *
 * Runs the existing Hono app behind API Gateway REST through
 * `hono/aws-lambda`. Uploads are accepted asynchronously (202) and handed to
 * the worker via SQS; decisions record the Cognito `sub` as `recordedBy`.
 *
 * The AWS bundle is imported directly from `../providers/aws/index.ts`:
 * `getProviders()` loads it through a non-literal dynamic import that a
 * bundler cannot follow. The default `handler` is built lazily on the first
 * invocation, so importing this module has no side effects.
 */

import type { Context } from "hono";
import { handle, type LambdaContext, type LambdaEvent } from "hono/aws-lambda";

import { loadConfig } from "../config.ts";
import { buildAwsProviders } from "../providers/aws/index.ts";
import type { ProviderBundle } from "../providers/interfaces.ts";
import { buildApp } from "../server/app.ts";
import type { RouteOptions } from "../server/routes.ts";
import { EventBridgePublisher } from "./aws-events.ts";
import { SqsUploadQueue } from "./aws-queue.ts";
import { createSubmitUpload } from "./submit-upload.ts";

export type ApiHandler = ReturnType<typeof handle>;

/**
 * Read the Cognito `sub` claim that the API Gateway Cognito authorizer puts
 * on the REST (v1) event. Every level is checked because local calls and
 * unauthenticated routes (/health) carry no authorizer at all.
 */
export function resolveCognitoActor(c: Context): string | undefined {
  const env: unknown = c.env;
  const sub = dig(env, ["event", "requestContext", "authorizer", "claims", "sub"]);
  return typeof sub === "string" && sub.length > 0 ? sub : undefined;
}

function dig(value: unknown, path: string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (current === null || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export function createApiHandler(deps: {
  providers: ProviderBundle;
  submitUpload?: RouteOptions["submitUpload"];
  onEvent?: RouteOptions["onEvent"];
}): ApiHandler {
  const app = buildApp({
    providers: deps.providers,
    routes: {
      submitUpload: deps.submitUpload,
      onEvent: deps.onEvent,
      authMode: "cognito",
      resolveActor: resolveCognitoActor,
    },
  });
  return handle(app);
}

/** Build the production handler from the Lambda environment. */
function createApiHandlerFromEnv(env: NodeJS.ProcessEnv): ApiHandler {
  const config = loadConfig(env);
  const providers = buildAwsProviders(config);
  const queue = new SqsUploadQueue({
    queueUrl: env.AGILIA_QUEUE_URL,
    region: config.aws.region,
  });
  const events = new EventBridgePublisher({
    busName: env.AGILIA_EVENT_BUS_NAME,
    region: config.aws.region,
  });
  return createApiHandler({
    providers,
    submitUpload: createSubmitUpload({ providers, queue, events }),
    onEvent: (detailType, detail) => events.publish(detailType, detail),
  });
}

let cachedHandler: ApiHandler | undefined;

/** Lambda handler: built once per execution environment, on first use. */
export const handler = (event: LambdaEvent, context?: LambdaContext) => {
  cachedHandler ??= createApiHandlerFromEnv(process.env);
  return cachedHandler(event, context);
};
