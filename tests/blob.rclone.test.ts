import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RcloneBlobStore } from "../src/core/blob/rclone.js";

function hasRclone(): boolean {
  try {
    execFileSync("rclone", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of iter) out.push(x);
  return out;
}

// Each test gets a fresh `:local:` rclone remote pointing at a temp dir.
// This exercises the real rclone CLI without needing network credentials.
describe.skipIf(!hasRclone())("RcloneBlobStore (against :local: backend)", () => {
  let root: string;
  let source: string;
  let blob: RcloneBlobStore;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "csk-rclone-"));
    source = join(root, "src.jsonl");
    writeFileSync(source, "hello");
    utimesSync(source, 1_700_000_000, 1_700_000_000);
    blob = new RcloneBlobStore({ remote: `:local:${join(root, "remote")}` });
  });

  afterAll(() => {
    // Nothing to do — temp dir will be cleaned up by the OS eventually.
  });

  it("reports the rclone version", async () => {
    const v = await blob.version();
    expect(v).toMatch(/rclone v/);
  });

  it("returns null for a missing blob", async () => {
    expect(await blob.stat("missing/file.jsonl")).toBeNull();
  });

  it("copies a file and can stat it back", async () => {
    const meta = await blob.putFile("proj/a.jsonl", source);
    expect(meta.size).toBe(5);
    const stat = await blob.stat("proj/a.jsonl");
    expect(stat).not.toBeNull();
    expect(stat!.size).toBe(5);
  });

  it("lists recursively under a prefix", async () => {
    await blob.putFile("pA/one.jsonl", source);
    await blob.putFile("pA/sub/two.jsonl", source);
    await blob.putFile("pB/three.jsonl", source);

    const all = await collect(blob.list());
    const keys = new Set(all.map((e) => e.key));
    expect(keys).toContain("pA/one.jsonl");
    expect(keys).toContain("pA/sub/two.jsonl");
    expect(keys).toContain("pB/three.jsonl");

    const onlyPA = await collect(blob.list("pA"));
    const pakeys = new Set(onlyPA.map((e) => e.key));
    expect(pakeys).toContain("pA/one.jsonl");
    expect(pakeys).toContain("pA/sub/two.jsonl");
    expect(pakeys).not.toContain("pB/three.jsonl");
  });

  it("deletes a blob and treats missing as a no-op", async () => {
    await blob.putFile("del/target.jsonl", source);
    expect(await blob.stat("del/target.jsonl")).not.toBeNull();
    await blob.delete("del/target.jsonl");
    expect(await blob.stat("del/target.jsonl")).toBeNull();
    await expect(blob.delete("del/target.jsonl")).resolves.toBeUndefined();
  });
});
