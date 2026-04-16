#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const src = resolve(root, "web", "dist");
const dst = resolve(root, "dist", "web");

if (!existsSync(src)) {
  console.error(`copy-web: source missing: ${src} (run "npm --prefix web run build" first)`);
  process.exit(1);
}

rmSync(dst, { recursive: true, force: true });
mkdirSync(dirname(dst), { recursive: true });
cpSync(src, dst, { recursive: true });
console.log(`copy-web: ${src} -> ${dst}`);
