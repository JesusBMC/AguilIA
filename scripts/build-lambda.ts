/**
 * Bundle the two Lambda entry points into self-contained Node.js ESM files.
 *
 *   dist/lambda/api/index.mjs     <- src/lambda/api.ts
 *   dist/lambda/worker/index.mjs  <- src/lambda/worker.ts
 *
 * The AWS SDK is bundled (versions pinned by bun.lock). Each output dir is
 * wiped first so the Terraform zip never carries stale files. Paths are
 * resolved from this file, so `bun run build:lambda` works from any cwd on
 * Windows, macOS and Linux.
 *
 * Usage: bun run build:lambda
 */

import { rm, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

const ENTRIES: Record<string, string> = {
  api: "src/lambda/api.ts",
  worker: "src/lambda/worker.ts",
};

// CJS dependencies bundled into ESM may still call require() for Node
// builtins; give them a real one.
const BANNER =
  'import { createRequire as __agiliaCreateRequire } from "node:module"; const require = __agiliaCreateRequire(import.meta.url);';

async function buildEntry(name: string, entry: string): Promise<void> {
  const outdir = join(ROOT, "dist", "lambda", name);
  await rm(outdir, { recursive: true, force: true });

  const result = await Bun.build({
    entrypoints: [join(ROOT, entry)],
    outdir,
    target: "node",
    format: "esm",
    minify: true,
    sourcemap: "none",
    naming: "index.mjs",
    banner: BANNER,
  });

  if (!result.success) {
    console.error(`[build-lambda] ${name}: el empaquetado falló`);
    for (const log of result.logs) {
      console.error(log);
    }
    process.exit(1);
  }

  for (const output of result.outputs) {
    const { size } = await stat(output.path);
    console.log(
      `[build-lambda] ${name}: ${output.path} (${(size / 1024).toFixed(1)} KB)`,
    );
  }
}

for (const [name, entry] of Object.entries(ENTRIES)) {
  await buildEntry(name, entry);
}
