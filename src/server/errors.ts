/**
 * Centralised error handling for the HTTP server.
 *
 * Handlers throw an {@link AppError} (or let an unexpected error bubble up);
 * {@link toHttp} turns any thrown value into a safe `{ status, body }` pair.
 * No stack traces, document text, PII or secrets are ever placed in a response
 * body or a log line — {@link logError} redacts before writing to stderr.
 */

import { redactForLog } from "../config.ts";
import type { ValidationError } from "./schemas.ts";

/** HTTP status codes this server can return. */
export type HttpStatus = 200 | 201 | 400 | 404 | 500;

export type ErrorCode = "VALIDATION" | "NOT_FOUND" | "INTERNAL";

/** The response body shape for any error. */
export interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    /** Field-level validation detail (safe: field names + generic messages). */
    details?: unknown;
  };
}

/** A deliberate, client-facing error with a safe public message. */
export class AppError extends Error {
  readonly status: HttpStatus;
  readonly code: ErrorCode;
  /** Message safe to show the client (no internals). */
  readonly publicMessage: string;
  readonly details?: unknown;

  constructor(
    status: HttpStatus,
    code: ErrorCode,
    publicMessage: string,
    details?: unknown,
  ) {
    super(publicMessage);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.publicMessage = publicMessage;
    this.details = details;
  }
}

/** 400 — invalid input at the boundary. */
export function badRequest(message: string, details?: unknown): AppError {
  return new AppError(400, "VALIDATION", message, details);
}

/** 400 built directly from a {@link ValidationError}. */
export function validationFailed(error: ValidationError): AppError {
  return new AppError(400, "VALIDATION", error.message, error.issues);
}

/** 404 — the requested resource does not exist. */
export function notFound(message: string): AppError {
  return new AppError(404, "NOT_FOUND", message);
}

/** 500 — unexpected server-side failure (generic public message). */
export function internal(message = "Error interno del servidor"): AppError {
  return new AppError(500, "INTERNAL", message);
}

/** The safe HTTP representation of an error. */
export interface HttpError {
  status: HttpStatus;
  body: ErrorBody;
}

/**
 * Map any thrown value to a safe `{ status, body }`. Known {@link AppError}s
 * keep their status and public message; anything else collapses to a generic
 * 500 so no internal detail or stack trace leaks to the client.
 */
export function toHttp(err: unknown): HttpError {
  if (err instanceof AppError) {
    const body: ErrorBody = {
      error: {
        code: err.code,
        message: err.publicMessage,
      },
    };
    if (err.details !== undefined) {
      body.error.details = err.details;
    }
    return { status: err.status, body };
  }
  return {
    status: 500,
    body: { error: { code: "INTERNAL", message: "Error interno del servidor" } },
  };
}

/**
 * Log an error to stderr for operators. Request bodies and document text are
 * never passed in; the small metadata object is still run through
 * {@link redactForLog} so any sensitive key is scrubbed defensively.
 */
export function logError(context: string, err: unknown): void {
  const meta =
    err instanceof AppError
      ? { code: err.code, status: err.status, message: err.publicMessage }
      : {
          code: "INTERNAL" as const,
          status: 500,
          message: err instanceof Error ? err.message : "unknown error",
        };
  // Unexpected (non-AppError) failures are the ones worth a stderr line.
  console.error(`[agilia] ${context}`, JSON.stringify(redactForLog(meta)));
}
