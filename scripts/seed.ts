/**
 * Seed script: run the inconsistencias sample through the full pipeline and
 * print the resulting document id + finding count.
 *
 * Usage: `bun run seed` (wired in package.json). Also handy for a manual demo:
 * it exercises extract → analyze → validate → draft → persist against the local
 * provider bundle and writes runtime state under `.data/`.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { buildLocalProviders } from "../src/providers/index.ts";
import { runPipeline } from "../src/pipeline/pipeline.ts";

const SAMPLE_RELATIVE = "../samples/estudio_previo_pgn_inconsistencias.txt";

async function main(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const samplePath = resolve(here, SAMPLE_RELATIVE);

  let text: string;
  try {
    text = await readFile(samplePath, "utf8");
  } catch (err) {
    throw new Error(
      `seed: could not read sample at ${samplePath}: ${(err as Error).message}`,
    );
  }

  const providers = buildLocalProviders();
  const record = await runPipeline(
    {
      filename: "estudio_previo_pgn_inconsistencias.txt",
      text,
      metadata: { procesoId: "AGL-2026-PGN41" },
    },
    providers,
  );

  const highAlerts = record.alerts.filter((a) => a.level === "HIGH").length;

  // Non-PII summary only (ids/counts), safe to print.
  console.log("AgilIA seed complete");
  console.log(`  documentId   : ${record.documentId}`);
  console.log(`  status       : ${record.status}`);
  console.log(`  findings     : ${record.findings.length}`);
  console.log(`  risk alerts  : ${record.alerts.length} (HIGH: ${highAlerts})`);
  console.log(`  draft versions: ${record.versions.length}`);
  console.log("  rules fired  :");
  for (const finding of record.findings) {
    console.log(`    - ${finding.ruleId} [${finding.severity}] (${finding.id})`);
  }
}

main().catch((err) => {
  console.error(`seed failed: ${(err as Error).message}`);
  process.exit(1);
});
