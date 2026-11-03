/**
 * JSON-file-backed {@link TraceStore}.
 *
 * Each document record is persisted as one JSON file under
 * `<dataDir>/trace/<documentId>.json`. Reads/writes go through an in-memory
 * cache that is lazily hydrated from disk, so decisions and versions survive
 * process restarts. Every fs op is wrapped — a missing document yields `null`,
 * real I/O errors propagate.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../../config.ts";
import type {
  Decision,
  DocumentRecord,
  DocumentVersion,
} from "../../domain/types.ts";
import type { DecisionInput, TraceStore } from "../interfaces.ts";

export class LocalTraceStore implements TraceStore {
  private readonly baseDir: string;
  private readonly cache = new Map<string, DocumentRecord>();

  constructor(baseDir: string = join(config.dataDir, "trace")) {
    this.baseDir = resolve(baseDir);
  }

  private fileFor(documentId: string): string {
    const safe = documentId.replace(/[^A-Za-z0-9._-]/g, "_");
    if (!safe) {
      throw new Error("LocalTraceStore: documentId must not be empty");
    }
    return join(this.baseDir, `${safe}.json`);
  }

  private async persist(record: DocumentRecord): Promise<void> {
    const file = this.fileFor(record.documentId);
    try {
      await mkdir(this.baseDir, { recursive: true });
      await writeFile(file, JSON.stringify(record, null, 2), "utf8");
    } catch (err) {
      throw new Error(
        `LocalTraceStore persist failed for "${record.documentId}": ${(err as Error).message}`,
      );
    }
    this.cache.set(record.documentId, record);
  }

  private async load(documentId: string): Promise<DocumentRecord | null> {
    const cached = this.cache.get(documentId);
    if (cached) return cached;

    const file = this.fileFor(documentId);
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new Error(
        `LocalTraceStore load failed for "${documentId}": ${(err as Error).message}`,
      );
    }
    try {
      const record = JSON.parse(raw) as DocumentRecord;
      this.cache.set(documentId, record);
      return record;
    } catch (err) {
      throw new Error(
        `LocalTraceStore: corrupt record for "${documentId}": ${(err as Error).message}`,
      );
    }
  }

  async saveDocument(record: DocumentRecord): Promise<void> {
    const now = new Date().toISOString();
    const toSave: DocumentRecord = {
      ...record,
      findings: record.findings ?? [],
      alerts: record.alerts ?? [],
      versions: record.versions ?? [],
      decisions: record.decisions ?? [],
      createdAt: record.createdAt ?? now,
      updatedAt: now,
    };
    await this.persist(toSave);
  }

  async getDocument(documentId: string): Promise<DocumentRecord | null> {
    return this.load(documentId);
  }

  async recordDecision(
    documentId: string,
    input: DecisionInput,
  ): Promise<Decision> {
    const record = await this.load(documentId);
    if (!record) {
      throw new Error(`LocalTraceStore: unknown document "${documentId}"`);
    }
    const decision: Decision = {
      id: randomUUID(),
      findingId: input.findingId,
      action: input.action,
      justification: input.justification,
      recordedAt: new Date().toISOString(),
    };
    if (input.recordedBy) {
      decision.recordedBy = input.recordedBy;
    }
    record.decisions = [...(record.decisions ?? []), decision];
    record.updatedAt = decision.recordedAt;
    await this.persist(record);
    return decision;
  }

  async addVersion(
    documentId: string,
    version: Omit<DocumentVersion, "version">,
  ): Promise<DocumentVersion> {
    const record = await this.load(documentId);
    if (!record) {
      throw new Error(`LocalTraceStore: unknown document "${documentId}"`);
    }
    const nextNumber =
      (record.versions ?? []).reduce((max, v) => Math.max(max, v.version), 0) + 1;
    const full: DocumentVersion = { ...version, version: nextNumber };
    record.versions = [...(record.versions ?? []), full];
    record.updatedAt = new Date().toISOString();
    await this.persist(record);
    return full;
  }

  async listVersions(documentId: string): Promise<DocumentVersion[]> {
    const record = await this.load(documentId);
    return record ? [...(record.versions ?? [])] : [];
  }

  async listDecisions(documentId: string): Promise<Decision[]> {
    const record = await this.load(documentId);
    return record ? [...(record.decisions ?? [])] : [];
  }
}
