/**
 * Boundary validation for the HTTP server (zod).
 *
 * Every request body / query is validated here before it reaches a handler,
 * so malformed or hostile input never reaches the pipeline. The exported
 * parsers return a discriminated {@link ParseResult} instead of throwing — the
 * routes turn a failed parse into a 400 via `errors.ts`.
 */

import { z } from "zod";

/** A single field-level validation problem (safe to return to the client). */
export interface ValidationIssue {
  /** Dot-path to the offending field (e.g. "metadata.entidad"). */
  path: string;
  message: string;
}

/** Shape returned when validation fails — never carries document text. */
export interface ValidationError {
  message: string;
  issues: ValidationIssue[];
}

/** Discriminated result: either parsed data or a structured validation error. */
export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ValidationError };

/** Trim + collapse whitespace; used to normalise free-text fields. */
const nonEmptyString = z
  .string()
  .trim()
  .min(1, "no debe estar vacío");

/** Upload body: `{ filename, text?, contentBase64?, metadata? }`. */
export const uploadBodySchema = z
  .object({
    filename: nonEmptyString.max(512, "nombre de archivo demasiado largo"),
    text: z.string().max(5_000_000, "texto demasiado grande").optional(),
    contentBase64: z
      .string()
      .max(10_000_000, "contenido demasiado grande")
      .optional(),
    metadata: z
      .object({
        entidad: z.string().trim().max(512).optional(),
        procesoId: z.string().trim().max(256).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (body) =>
      (typeof body.text === "string" && body.text.trim().length > 0) ||
      (typeof body.contentBase64 === "string" &&
        body.contentBase64.trim().length > 0),
    {
      message: "debe incluir 'text' o 'contentBase64'",
      path: ["text"],
    },
  );

export type UploadBody = z.infer<typeof uploadBodySchema>;

/**
 * Decision body: `{ findingId, action, justification }`. The `justification`
 * is always OPTIONAL — nothing blocks. When a REJECT arrives without one, the
 * route still records the decision and returns a non-blocking alert inviting
 * the user to justify it (see routes.ts), honouring the "color + recomendación,
 * sin bloqueantes" rule.
 */
export const decisionBodySchema = z
  .object({
    findingId: nonEmptyString.max(256, "findingId demasiado largo"),
    action: z.enum(["ACCEPT", "REJECT"]),
    justification: z.string().trim().max(5000, "justificación demasiado larga").optional(),
  })
  .strict();

export type DecisionBody = z.infer<typeof decisionBodySchema>;

/** Search query: `?q=` must be a non-empty string. */
export const searchQuerySchema = z
  .object({
    q: nonEmptyString.max(512, "consulta demasiado larga"),
  })
  .strict();

export type SearchQuery = z.infer<typeof searchQuerySchema>;

/** Map a zod error into our safe {@link ValidationError} shape. */
function toValidationError(error: z.ZodError): ValidationError {
  const issues: ValidationIssue[] = error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
  return { message: "Entrada inválida", issues };
}

/** Run a schema and adapt its result to {@link ParseResult}. */
function parseWith<T>(schema: z.ZodType<T>, raw: unknown): ParseResult<T> {
  const result = schema.safeParse(raw);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  return { ok: false, error: toValidationError(result.error) };
}

export function parseUploadBody(raw: unknown): ParseResult<UploadBody> {
  return parseWith(uploadBodySchema, raw);
}

export function parseDecisionBody(raw: unknown): ParseResult<DecisionBody> {
  return parseWith(decisionBodySchema, raw);
}

export function parseSearchQuery(raw: unknown): ParseResult<SearchQuery> {
  return parseWith(searchQuerySchema, raw);
}
