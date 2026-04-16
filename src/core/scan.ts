import { readdir, stat } from "node:fs/promises";
import { join, posix, sep } from "node:path";

export interface SourceFile {
  /** Path relative to the source root, using POSIX separators. */
  relativeKey: string;
  sourcePath: string;
  size: number;
  mtime: Date;
}

export type SessionKind = "main" | "subagent";

export interface ClassifiedSession {
  kind: SessionKind;
  projectDir: string;
  sessionId: string;
  parentSessionId: string | null;
}

/**
 * Recursively walk the source directory, yielding every file with its
 * POSIX-style relative key (used as both blob key and DB source_key).
 *
 * Hidden dotfiles are skipped so that OS metadata (`.DS_Store`, `.Trashes`)
 * does not pollute the mirror.
 */
export async function* walkFiles(sourceDir: string): AsyncGenerator<SourceFile> {
  yield* walk(sourceDir, "");
}

async function* walk(absRoot: string, relPrefix: string): AsyncGenerator<SourceFile> {
  const absPath = relPrefix ? join(absRoot, relPrefix.split(posix.sep).join(sep)) : absRoot;
  const entries = await safeReaddir(absPath);
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const childRel = relPrefix ? posix.join(relPrefix, entry.name) : entry.name;
    const childAbs = join(absPath, entry.name);
    if (entry.isDirectory()) {
      yield* walk(absRoot, childRel);
    } else if (entry.isFile()) {
      const s = await stat(childAbs);
      yield {
        relativeKey: childRel,
        sourcePath: childAbs,
        size: s.size,
        mtime: s.mtime,
      };
    }
  }
}

async function safeReaddir(path: string) {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return [];
    throw err;
  }
}

/**
 * Classify a relative path into a session record, if it looks like one.
 * Recognised layouts:
 *   <projectDir>/<uuid>.jsonl                                   → main session
 *   <projectDir>/<uuid>/subagents/<subagent>.jsonl              → subagent session
 * Anything else returns null — it will still be mirrored, just not indexed.
 */
export function classifySessionFile(relativeKey: string): ClassifiedSession | null {
  if (!relativeKey.endsWith(".jsonl")) return null;
  const parts = relativeKey.split(posix.sep);

  if (parts.length === 2) {
    const [projectDir, file] = parts as [string, string];
    return {
      kind: "main",
      projectDir,
      sessionId: stripExt(file),
      parentSessionId: null,
    };
  }

  if (parts.length === 4 && parts[2] === "subagents") {
    const [projectDir, parentSessionId, , file] = parts as [string, string, string, string];
    return {
      kind: "subagent",
      projectDir,
      sessionId: stripExt(file),
      parentSessionId,
    };
  }

  return null;
}

function stripExt(filename: string): string {
  return filename.replace(/\.jsonl$/, "");
}

/** First path segment == the project directory. */
export function projectOf(relativeKey: string): string {
  const idx = relativeKey.indexOf(posix.sep);
  return idx === -1 ? relativeKey : relativeKey.slice(0, idx);
}
