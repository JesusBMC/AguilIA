/**
 * Filesystem-backed {@link Storage} implementation.
 *
 * Keys map to files beneath a base directory (default: `config.dataDir`).
 * Key segments separated by "/" become nested directories; unsafe path
 * characters are sanitized so a key can never escape the base directory.
 * Every fs operation is wrapped: a missing key yields `null` from `get`,
 * while genuine I/O errors are surfaced (never silently swallowed).
 */

import { mkdir, readFile, writeFile, readdir, stat, lstat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { config } from "../../config.ts";
import type { Storage } from "../interfaces.ts";

export class LocalStorage implements Storage {
  private readonly baseDir: string;

  constructor(baseDir: string = join(config.dataDir, "blobs")) {
    this.baseDir = resolve(baseDir);
  }

  /** Map a logical key to an absolute file path, guarding against traversal. */
  private resolveKey(key: string): string {
    if (typeof key !== "string" || key.trim() === "") {
      throw new Error("LocalStorage: key must be a non-empty string");
    }
    // Sanitize each segment; collapse any ".." so keys stay inside baseDir.
    const safeSegments = key
      .split(/[/\\]+/)
      .map((segment) => segment.replace(/[^A-Za-z0-9._-]/g, "_"))
      .filter((segment) => segment.length > 0 && segment !== "." && segment !== "..");
    if (safeSegments.length === 0) {
      throw new Error(`LocalStorage: key resolved to empty path: "${key}"`);
    }
    const target = resolve(this.baseDir, ...safeSegments);
    const rel = relative(this.baseDir, target);
    if (rel.startsWith("..") || rel.includes(`..${sep}`)) {
      throw new Error(`LocalStorage: key escapes base directory: "${key}"`);
    }
    return target;
  }

  async put(key: string, value: string): Promise<void> {
    const filePath = this.resolveKey(key);
    try {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, value, "utf8");
    } catch (err) {
      throw new Error(
        `LocalStorage.put failed for key "${key}": ${(err as Error).message}`,
      );
    }
  }

  async get(key: string): Promise<string | null> {
    const filePath = this.resolveKey(key);
    try {
      return await readFile(filePath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw new Error(
        `LocalStorage.get failed for key "${key}": ${(err as Error).message}`,
      );
    }
  }

  async list(prefix?: string): Promise<string[]> {
    const keys: string[] = [];
    // NOTE: readdir(..., { withFileTypes: true }) can throw EPERM on
    // Windows/Bun for some paths, so we read names and lstat each entry.
    const walk = async (dir: string): Promise<void> => {
      let names: string[];
      try {
        names = await readdir(dir);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
        throw new Error(
          `LocalStorage.list failed reading "${dir}": ${(err as Error).message}`,
        );
      }
      for (const name of names) {
        const full = join(dir, name);
        let info;
        try {
          info = await lstat(full);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw new Error(
            `LocalStorage.list failed to stat "${full}": ${(err as Error).message}`,
          );
        }
        if (info.isDirectory()) {
          await walk(full);
        } else if (info.isFile()) {
          const key = relative(this.baseDir, full).split(sep).join("/");
          keys.push(key);
        }
      }
    };

    try {
      await stat(this.baseDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new Error(
        `LocalStorage.list failed to stat base dir: ${(err as Error).message}`,
      );
    }

    await walk(this.baseDir);
    const filtered = prefix ? keys.filter((k) => k.startsWith(prefix)) : keys;
    return filtered.sort();
  }
}
