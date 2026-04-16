import { mkdtempSync, writeFileSync, readFileSync, utimesSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FsBlobStore } from "../src/core/blob/fs.js";

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iter) out.push(item);
  return out;
}

function setup() {
  const root = mkdtempSync(join(tmpdir(), "csk-blob-"));
  const source = join(root, "src.jsonl");
  writeFileSync(source, "hello");
  const blob = new FsBlobStore(join(root, "mirror"));
  return { root, source, blob };
}

describe("FsBlobStore", () => {
  it("returns null for missing blobs", async () => {
    const { blob } = setup();
    expect(await blob.stat("nope/x.jsonl")).toBeNull();
  });

  it("copies a file and reports size + mtime", async () => {
    const { blob, source } = setup();
    const meta = await blob.putFile("proj/a.jsonl", source);
    expect(meta.size).toBe(5);
    expect(existsSync(blob.resolve("proj/a.jsonl"))).toBe(true);
    expect(readFileSync(blob.resolve("proj/a.jsonl"), "utf8")).toBe("hello");
  });

  it("overwrites on re-put (supports incremental refresh)", async () => {
    const { blob, source } = setup();
    await blob.putFile("proj/a.jsonl", source);
    writeFileSync(source, "hello world");
    utimesSync(source, 1_700_000_000, 1_700_000_000);
    const meta = await blob.putFile("proj/a.jsonl", source);
    expect(meta.size).toBe(11);
    expect(readFileSync(blob.resolve("proj/a.jsonl"), "utf8")).toBe("hello world");
  });

  it("lists every blob recursively", async () => {
    const { blob, source } = setup();
    await blob.putFile("projA/a.jsonl", source);
    await blob.putFile("projA/sub/b.jsonl", source);
    await blob.putFile("projB/c.jsonl", source);

    const all = await collect(blob.list());
    expect(all.map((e) => e.key).sort()).toEqual([
      "projA/a.jsonl",
      "projA/sub/b.jsonl",
      "projB/c.jsonl",
    ]);
  });

  it("lists with a prefix", async () => {
    const { blob, source } = setup();
    await blob.putFile("projA/a.jsonl", source);
    await blob.putFile("projA/sub/b.jsonl", source);
    await blob.putFile("projB/c.jsonl", source);

    const onlyA = await collect(blob.list("projA"));
    expect(onlyA.map((e) => e.key).sort()).toEqual(["projA/a.jsonl", "projA/sub/b.jsonl"]);
  });

  it("deletes blobs (and silently ignores missing)", async () => {
    const { blob, source } = setup();
    await blob.putFile("proj/a.jsonl", source);
    expect(await blob.stat("proj/a.jsonl")).not.toBeNull();
    await blob.delete("proj/a.jsonl");
    expect(await blob.stat("proj/a.jsonl")).toBeNull();
    // No-op on missing
    await expect(blob.delete("proj/a.jsonl")).resolves.toBeUndefined();
  });
});
