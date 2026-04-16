import { createReadStream, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SessionStore } from "../store/index.js";
import { routeApi } from "./router.js";

export interface ServeOptions {
  store: SessionStore;
  hostId: string;
  userId: string;
  dataDir: string;
  port: number;
  host?: string;
  webRoot?: string;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

export function startServer(options: ServeOptions): Promise<{ server: Server; url: string }> {
  const webRoot = resolve(options.webRoot ?? defaultWebRoot());
  const ctx = {
    store: options.store,
    hostId: options.hostId,
    userId: options.userId,
    dataDir: options.dataDir,
  };

  const server = createServer((req, res) => {
    handle(req, res, ctx, webRoot).catch((err) => {
      respondJson(res, 500, { error: (err as Error).message });
    });
  });

  return new Promise((resolveStart) => {
    server.listen(options.port, options.host ?? "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : options.port;
      const url = `http://${options.host ?? "127.0.0.1"}:${port}`;
      resolveStart({ server, url });
    });
  });
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: { store: SessionStore; hostId: string; userId: string; dataDir: string },
  webRoot: string,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;

  if (pathname.startsWith("/api/")) {
    const query: Record<string, string> = {};
    for (const [k, v] of url.searchParams) query[k] = v;
    const result = await routeApi(ctx, {
      method: req.method ?? "GET",
      path: pathname,
      query,
    });
    respondJson(res, result.status, result.body);
    return;
  }

  await serveStatic(res, webRoot, pathname);
}

async function serveStatic(res: ServerResponse, webRoot: string, urlPath: string): Promise<void> {
  const safePath = sanitizePath(urlPath);
  const candidate = join(webRoot, safePath);

  const resolved = resolve(candidate);
  if (!resolved.startsWith(resolve(webRoot))) {
    respondJson(res, 403, { error: "Forbidden" });
    return;
  }

  let target = resolved;
  let stat = tryStat(target);

  if (stat?.isDirectory()) {
    target = join(target, "index.html");
    stat = tryStat(target);
  }

  if (!stat || !stat.isFile()) {
    const indexPath = join(webRoot, "index.html");
    const indexStat = tryStat(indexPath);
    if (indexStat?.isFile()) {
      sendFile(res, indexPath, "text/html; charset=utf-8");
      return;
    }
    respondJson(res, 404, {
      error: "Web bundle not found. Run `npm run build:web` first.",
      webRoot,
    });
    return;
  }

  const ext = extOf(target);
  sendFile(res, target, MIME[ext] ?? "application/octet-stream");
}

function sendFile(res: ServerResponse, file: string, contentType: string): void {
  res.statusCode = 200;
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "no-cache");
  createReadStream(file).pipe(res);
}

function respondJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function sanitizePath(urlPath: string): string {
  const decoded = decodeURIComponent(urlPath || "/");
  const normalized = normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  return normalized === "/" || normalized === "" ? "index.html" : normalized.replace(/^\/+/, "");
}

function extOf(path: string): string {
  const i = path.lastIndexOf(".");
  return i < 0 ? "" : path.slice(i).toLowerCase();
}

function tryStat(path: string): ReturnType<typeof statSync> | null {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

function defaultWebRoot(): string {
  // src/core/web/server.ts → ../../.. = package root; dist/core/web/server.js → ../../.. = package root
  const here = fileURLToPath(new URL(".", import.meta.url));
  return join(here, "..", "..", "..", "dist", "web");
}
