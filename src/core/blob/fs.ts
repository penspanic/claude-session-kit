import { copyFile, mkdir, readdir, rm, stat, utimes } from "node:fs/promises";
import { dirname, join, posix, sep } from "node:path";
import type { BlobEntry, BlobMeta, BlobStore } from "./index.js";

export class FsBlobStore implements BlobStore {
  constructor(private readonly root: string) {}

  async stat(key: string): Promise<BlobMeta | null> {
    try {
      const s = await stat(this.resolve(key));
      return { size: s.size, mtime: s.mtime };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async putFile(key: string, sourcePath: string): Promise<BlobMeta> {
    const target = this.resolve(key);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(sourcePath, target);
    // Preserve source mtime so incremental runs can detect "no change".
    const sourceStat = await stat(sourcePath);
    await utimes(target, sourceStat.atime, sourceStat.mtime);
    return { size: sourceStat.size, mtime: sourceStat.mtime };
  }

  async *list(prefix = ""): AsyncIterable<BlobEntry> {
    const root = prefix ? this.resolve(prefix) : this.root;
    yield* walk(root, prefix);
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  resolve(key: string): string {
    // Accept POSIX-style keys regardless of host separator.
    return join(this.root, key.split(posix.sep).join(sep));
  }
}

async function* walk(absPath: string, relPrefix: string): AsyncIterable<BlobEntry> {
  let entries;
  try {
    entries = await readdir(absPath, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  for (const entry of entries) {
    const childRel = relPrefix ? posix.join(relPrefix, entry.name) : entry.name;
    const childAbs = join(absPath, entry.name);
    if (entry.isDirectory()) {
      yield* walk(childAbs, childRel);
    } else if (entry.isFile()) {
      const s = await stat(childAbs);
      yield { key: childRel, size: s.size, mtime: s.mtime };
    }
  }
}
