/**
 * Offline smoke check for the built Lambda bundles (no AWS call is made).
 *
 * 1. Sets a fake AWS-mode environment (fake resource names and dummy
 *    credentials, so SDK construction never looks for a local profile).
 * 2. Imports dist/lambda/api/index.mjs and invokes its handler with a minimal
 *    API Gateway REST (v1) event for GET /health: expects 200 and
 *    "auth":"cognito".
 * 3. Imports dist/lambda/worker/index.mjs and checks it exports a handler.
 *
 * Usage: bun run build:lambda && bun run verify:lambda
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

// Fake, non-secret values: only enough for the bundles to construct clients.
Object.assign(process.env, {
  AIDLC_PROVIDER: "aws",
  AWS_REGION: "us-east-2",
  AWS_S3_BUCKET: "verify-bucket",
  AWS_DYNAMODB_TRACEABILITY_TABLE: "verify-traceability",
  AWS_DYNAMODB_FINDINGS_TABLE: "verify-findings",
  AGILIA_QUEUE_URL: "https://sqs.us-east-2.amazonaws.com/000000000000/verify",
  AGILIA_EVENT_BUS_NAME: "verify",
  AWS_SEARCH_BACKEND: "dynamodb",
  AWS_ACCESS_KEY_ID: "verify-only-fake-access-key",
  AWS_SECRET_ACCESS_KEY: "verify-only-not-a-real-secret",
});

function fail(message: string): never {
  console.error(`[verify-lambda] ERROR: ${message}`);
  process.exit(1);
}

async function loadBundle(name: string): Promise<Record<string, unknown>> {
  const file = join(ROOT, "dist", "lambda", name, "index.mjs");
  if (!existsSync(file)) {
    fail(`no existe ${file}; ejecute bun run build:lambda`);
  }
  try {
    return (await import(pathToFileURL(file).href)) as Record<string, unknown>;
  } catch (err) {
    fail(`no se pudo importar ${file}: ${(err as Error).message}`);
  }
}

const healthEvent = {
  httpMethod: "GET",
  path: "/health",
  resource: "/health",
  headers: { Host: "verify.execute-api.us-east-2.amazonaws.com" },
  multiValueHeaders: { Host: ["verify.execute-api.us-east-2.amazonaws.com"] },
  queryStringParameters: null,
  multiValueQueryStringParameters: null,
  pathParameters: null,
  stageVariables: null,
  requestContext: {
    stage: "dev",
    path: "/dev/health",
    httpMethod: "GET",
    requestId: "verify-request",
    resourcePath: "/health",
    identity: { sourceIp: "127.0.0.1" },
  },
  body: null,
  isBase64Encoded: false,
};

const api = await loadBundle("api");
if (typeof api.handler !== "function") {
  fail("dist/lambda/api/index.mjs no exporta 'handler'");
}
const apiHandler = api.handler as (
  event: unknown,
) => Promise<{ statusCode: number; body: string }>;

let response: { statusCode: number; body: string };
try {
  response = await apiHandler(healthEvent);
} catch (err) {
  fail(`el handler de la API lanzó un error: ${(err as Error).message}`);
}
if (response.statusCode !== 200) {
  fail(`GET /health devolvió ${response.statusCode}, se esperaba 200: ${response.body}`);
}
if (!response.body.includes('"auth":"cognito"')) {
  fail(`GET /health no reporta auth cognito: ${response.body}`);
}
console.log(`[verify-lambda] api: GET /health -> ${response.statusCode} ${response.body}`);

const worker = await loadBundle("worker");
if (typeof worker.handler !== "function") {
  fail("dist/lambda/worker/index.mjs no exporta 'handler'");
}
console.log("[verify-lambda] worker: handler exportado");
console.log("[verify-lambda] OK");
