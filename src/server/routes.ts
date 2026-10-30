/**
 * HTTP route handlers.
 *
 * Each handler validates its input via `schemas.ts`, does its work against a
 * shared {@link ProviderBundle} + the pipeline, and returns a typed JSON body.
 * All failures are funnelled through `errors.ts` so responses never leak a
 * stack trace or internal detail. Routes are mounted by `app.ts`.
 */

import type { Context, Hono } from "hono";
import type { ProviderBundle } from "../providers/interfaces.ts";
import { runPipeline } from "../pipeline/pipeline.ts";
import {
  AppError,
  badRequest,
  logError,
  notFound,
  toHttp,
  validationFailed,
  type HttpStatus,
} from "./errors.ts";
import {
  parseDecisionBody,
  parseSearchQuery,
  parseUploadBody,
} from "./schemas.ts";

/** Resolves the one shared provider bundle (built once, reused per request). */
export type BundleResolver = () => Promise<ProviderBundle>;

/** Read and JSON-parse a request body, mapping a bad body to a 400. */
async function readJsonBody(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw badRequest("El cuerpo de la petición debe ser JSON válido");
  }
}

/**
 * Run a handler and translate any thrown value into a safe JSON response.
 * Unexpected (non-{@link AppError}) failures are logged to stderr, never
 * returned verbatim.
 */
async function guard(
  c: Context,
  context: string,
  fn: () => Promise<Response>,
): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (!(err instanceof AppError)) {
      logError(context, err);
    }
    const { status, body } = toHttp(err);
    return c.json(body, status);
  }
}

/** Register every AgilIA route onto `app`, backed by `getBundle`. */
export function registerRoutes(app: Hono, getBundle: BundleResolver): void {
  // Liveness probe (handy for the UI / manual checks).
  app.get("/health", (c) => c.json({ status: "ok", auth: "none" }, 200));

  // POST /documents/upload — run the full pipeline synchronously.
  app.post("/documents/upload", (c) =>
    guard(c, "POST /documents/upload", async () => {
      const raw = await readJsonBody(c);
      const parsed = parseUploadBody(raw);
      if (!parsed.ok) {
        throw validationFailed(parsed.error);
      }

      const providers = await getBundle();
      const record = await runPipeline(
        {
          filename: parsed.data.filename,
          text: parsed.data.text,
          contentBase64: parsed.data.contentBase64,
          metadata: parsed.data.metadata,
        },
        providers,
      );

      return c.json(
        {
          documentId: record.documentId,
          status: record.status,
          extracted: record.extracted,
          findings: record.findings,
          alerts: record.alerts,
        },
        201 satisfies HttpStatus,
      );
    }),
  );

  // GET /documents/:id — full persisted record, or 404.
  app.get("/documents/:id", (c) =>
    guard(c, "GET /documents/:id", async () => {
      const id = c.req.param("id");
      const providers = await getBundle();
      const record = await providers.traceStore.getDocument(id);
      if (!record) {
        throw notFound(`Documento no encontrado: ${id}`);
      }
      return c.json(record, 200 satisfies HttpStatus);
    }),
  );

  // GET /documents/:id/draft — latest draft markdown (?download=1 => attachment).
  app.get("/documents/:id/draft", (c) =>
    guard(c, "GET /documents/:id/draft", async () => {
      const id = c.req.param("id");
      const providers = await getBundle();

      const record = await providers.traceStore.getDocument(id);
      if (!record) {
        throw notFound(`Documento no encontrado: ${id}`);
      }

      const versions = record.versions ?? [];
      const latest = versions.reduce<(typeof versions)[number] | undefined>(
        (max, v) => (max && max.version >= v.version ? max : v),
        undefined,
      );
      if (!latest) {
        throw notFound(`El documento ${id} aún no tiene un borrador`);
      }

      const content = await providers.storage.get(latest.storageKey);
      if (content === null) {
        throw notFound(`El borrador del documento ${id} no está disponible`);
      }

      if (c.req.query("download") === "1") {
        c.header(
          "Content-Disposition",
          `attachment; filename="borrador-${id}-v${latest.version}.md"`,
        );
      }

      return c.json(
        {
          documentId: id,
          version: latest.version,
          format: "markdown" as const,
          content,
        },
        200 satisfies HttpStatus,
      );
    }),
  );

  // POST /documents/:id/decision — record an ACCEPT/REJECT decision.
  app.post("/documents/:id/decision", (c) =>
    guard(c, "POST /documents/:id/decision", async () => {
      const id = c.req.param("id");
      const raw = await readJsonBody(c);
      const parsed = parseDecisionBody(raw);
      if (!parsed.ok) {
        throw validationFailed(parsed.error);
      }

      const providers = await getBundle();
      const record = await providers.traceStore.getDocument(id);
      if (!record) {
        throw notFound(`Documento no encontrado: ${id}`);
      }

      const decision = await providers.traceStore.recordDecision(id, {
        findingId: parsed.data.findingId,
        action: parsed.data.action,
        justification: parsed.data.justification ?? "",
      });

      return c.json(
        { decisionId: decision.id, recordedAt: decision.recordedAt },
        200 satisfies HttpStatus,
      );
    }),
  );

  // GET /search?q= — lexical search over indexed findings.
  app.get("/search", (c) =>
    guard(c, "GET /search", async () => {
      const parsed = parseSearchQuery({ q: c.req.query("q") });
      if (!parsed.ok) {
        throw validationFailed(parsed.error);
      }

      const providers = await getBundle();
      const results = await providers.searchIndex.search(parsed.data.q);

      return c.json(
        { query: parsed.data.q, results },
        200 satisfies HttpStatus,
      );
    }),
  );
}
