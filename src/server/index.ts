/**
 * Server entry point — boots the Hono app on `config.port`.
 *
 * Run ONLY via `bun run dev` / `bun run start`; the test suite never imports
 * this file (it uses `buildApp()` + `app.fetch(...)` in-process). On boot we
 * print a loud, explicit warning that this local server has NO authentication:
 * Amazon Cognito is the production authentication boundary and its absence
 * here is the known MVP security gap.
 */

import { config } from "../config.ts";
import { buildApp } from "./app.ts";

const app = buildApp();

console.warn(
  "[agilia] ADVERTENCIA DE SEGURIDAD: este servidor local NO tiene autenticación (sin Cognito). " +
    "Amazon Cognito es la frontera de autenticación de producción — brecha de seguridad conocida del MVP.",
);

const server = Bun.serve({
  port: config.port,
  fetch: app.fetch,
});

console.log(
  `[agilia] servidor escuchando en http://localhost:${server.port} (proveedor: ${config.provider})`,
);
