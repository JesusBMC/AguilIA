/**
 * Builds the Hono application.
 *
 * `buildApp()` returns a configured Hono instance with the API routes mounted,
 * permissive CORS for the local UI, and a small static handler that serves the
 * SPA under `web/` so the UI and API share one origin. It deliberately does
 * NOT start a listener — `index.ts` does that — which keeps the app testable
 * in-process via `app.fetch(new Request(...))`.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { getProviders } from "../providers/index.ts";
import type { ProviderBundle } from "../providers/interfaces.ts";
import { registerRoutes, type BundleResolver } from "./routes.ts";

/** Options for {@link buildApp}; tests may inject an isolated bundle. */
export interface BuildAppOptions {
  /** Override the provider bundle (e.g. with temp storage dirs in tests). */
  providers?: ProviderBundle;
}

/** Absolute path to the static web directory (`<root>/web`). */
const WEB_DIR = fileURLToPath(new URL("../../web/", import.meta.url));

/** Minimal content-type lookup for the handful of assets we serve. */
function contentTypeFor(file: string): string {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  return "application/octet-stream";
}

/** Serve one static asset from `web/`, or 404 when it is missing. */
async function serveWebFile(fileName: string): Promise<Response> {
  try {
    const body = await readFile(WEB_DIR + fileName, "utf8");
    return new Response(body, {
      status: 200,
      headers: { "content-type": contentTypeFor(fileName) },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

/**
 * Create a resolver that builds the provider bundle exactly once and reuses it
 * for every request. Sharing the bundle matters: the local search index lives
 * in memory, so a document uploaded on one request must be searchable on the
 * next through the same instance.
 */
function memoizedBundle(injected?: ProviderBundle): BundleResolver {
  if (injected) {
    return async () => injected;
  }
  let promise: Promise<ProviderBundle> | undefined;
  return () => {
    if (!promise) {
      promise = getProviders();
    }
    return promise;
  };
}

export function buildApp(options: BuildAppOptions = {}): Hono {
  const app = new Hono();

  // Permissive CORS so the local SPA (same origin, or a dev origin) can call us.
  app.use("*", cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"] }));

  const getBundle = memoizedBundle(options.providers);
  registerRoutes(app, getBundle);

  // Static SPA: index at "/" and "/index.html", plus the app script.
  app.get("/", () => serveWebFile("index.html"));
  app.get("/index.html", () => serveWebFile("index.html"));
  app.get("/app.js", () => serveWebFile("app.js"));

  return app;
}
