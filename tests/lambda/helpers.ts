/**
 * Shared fixtures for the Lambda tests: isolated local provider bundles (temp
 * dirs under <root>/.data), recording fakes for the queue and event bus, and
 * a minimal API Gateway REST (v1) event builder.
 */

import { join } from "node:path";
import type { ProviderBundle } from "../../src/providers/interfaces.ts";
import { LocalStorage } from "../../src/providers/local/local-storage.ts";
import { LocalTraceStore } from "../../src/providers/local/local-trace-store.ts";
import { LocalSearchIndex } from "../../src/providers/local/local-search-index.ts";
import { LocalDocumentExtractor } from "../../src/providers/local/local-document-extractor.ts";
import { LocalNlpAnalyzer } from "../../src/providers/local/local-nlp-analyzer.ts";
import { LocalRuleValidator } from "../../src/providers/local/local-rule-validator.ts";
import { LocalDraftGenerator } from "../../src/providers/local/local-draft-generator.ts";
import type { EventPublisher } from "../../src/lambda/aws-events.ts";
import type { UploadMessage, UploadQueue } from "../../src/lambda/aws-queue.ts";

export const SAMPLE = [
  "ESTUDIO PREVIO",
  "Entidad: Procuraduria General de la Nacion",
  "Proceso: AGL-2026-PGN41",
  "Objeto: Adquisicion, implementacion y soporte tecnologico para la PGN",
  "Modalidad de seleccion: Seleccion abreviada - Bolsa de Productos (BMC)",
  "Valor total sin IVA: $51.460.675.487",
  "Valor total con IVA y costos: $61.587.261.594",
  "CDP No. 40626 por valor de $61.587.261.594",
  "Fecha de publicacion: 10/06/2026",
  "Fecha de cierre: 20/06/2026",
  "Plazo de ejecucion: 180 dias",
  "Items / bienes a adquirir:",
  "3. Estacion de trabajo Mac Studio M3 Ultra - Cantidad: 5 - Marca: Apple",
].join("\n");

export function buildIsolatedProviders(dir: string): ProviderBundle {
  return {
    documentExtractor: new LocalDocumentExtractor(),
    nlpAnalyzer: new LocalNlpAnalyzer(),
    ruleValidator: new LocalRuleValidator(),
    draftGenerator: new LocalDraftGenerator(),
    storage: new LocalStorage(join(dir, "blobs")),
    traceStore: new LocalTraceStore(join(dir, "trace")),
    searchIndex: new LocalSearchIndex(),
  };
}

export class RecordingQueue implements UploadQueue {
  readonly sent: UploadMessage[] = [];
  async send(message: UploadMessage): Promise<void> {
    this.sent.push(message);
  }
}

export class RecordingEvents implements EventPublisher {
  readonly published: { detailType: string; detail: Record<string, unknown> }[] =
    [];
  failWith?: Error;
  async publish(
    detailType: string,
    detail: Record<string, unknown>,
  ): Promise<void> {
    if (this.failWith) {
      throw this.failWith;
    }
    this.published.push({ detailType, detail });
  }
}

/** Build a minimal API Gateway REST (v1) proxy event. */
export function restEvent(options: {
  method: string;
  path: string;
  body?: unknown;
  rawBody?: string;
  sub?: string;
}): Record<string, unknown> {
  const host = "test.execute-api.us-east-2.amazonaws.com";
  const body =
    options.rawBody ??
    (options.body === undefined ? null : JSON.stringify(options.body));
  return {
    httpMethod: options.method,
    path: options.path,
    resource: options.path,
    headers: { Host: host, "Content-Type": "application/json" },
    multiValueHeaders: {
      Host: [host],
      "Content-Type": ["application/json"],
    },
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    requestContext: {
      stage: "dev",
      path: `/dev${options.path}`,
      httpMethod: options.method,
      requestId: "test-request",
      resourcePath: options.path,
      identity: { sourceIp: "127.0.0.1" },
      ...(options.sub
        ? { authorizer: { claims: { sub: options.sub } } }
        : {}),
    },
    body,
    isBase64Encoded: false,
  };
}
