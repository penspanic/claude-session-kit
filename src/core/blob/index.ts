import type { Config } from "../config.js";
import { FsBlobStore } from "./fs.js";
import { RcloneBlobStore } from "./rclone.js";

export interface BlobMeta {
  size: number;
  mtime: Date;
}

export interface BlobEntry extends BlobMeta {
  key: string;
}

export interface BlobStore {
  /** Current size+mtime of a blob, or null if absent. */
  stat(key: string): Promise<BlobMeta | null>;

  /** Copy a local file into the blob store. Should preserve mtime when possible. */
  putFile(key: string, sourcePath: string): Promise<BlobMeta>;

  /** Enumerate blobs under `prefix` (recursive). Absent prefix = "". */
  list(prefix?: string): AsyncIterable<BlobEntry>;

  /** Remove a blob. No-op if missing. */
  delete(key: string): Promise<void>;

  /** Optional: resolve a blob key to a local filesystem path. Only meaningful for `fs:`. */
  resolve?(key: string): string;
}

export function createBlob(config: Config): BlobStore {
  switch (config.blob.type) {
    case "fs":
      return new FsBlobStore(config.blob.root);
    case "rclone":
      return new RcloneBlobStore({
        remote: config.blob.remote,
        rcloneBin: config.blob.rcloneBin,
        configPath: config.blob.configPath,
      });
    default: {
      const type: never = config.blob;
      throw new Error(`Unsupported blob type: ${JSON.stringify(type)}`);
    }
  }
}
