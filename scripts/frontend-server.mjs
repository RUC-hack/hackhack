import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnvFile } from "../src/server/config/env.mjs";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

function frontendSettings() {
  return {
    port: Number(process.env.FRONTEND_PORT || 8080),
    host: process.env.FRONTEND_HOST || "127.0.0.1",
  };
}

function apiBaseUrl() {
  const configured = String(process.env.APP_BASE_URL || "").trim().replace(/\/$/u, "");
  if (configured) return configured;
  const appHost = String(process.env.APP_HOST || "127.0.0.1").trim();
  const browserHost = ["0.0.0.0", "::", "[::]"].includes(appHost) ? "127.0.0.1" : appHost;
  return `http://${browserHost}:${process.env.APP_PORT || 3000}`;
}

function resolveFile(requestUrl) {
  const { host, port } = frontendSettings();
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(requestUrl ?? "/", `http://${host}:${port}`).pathname);
  } catch {
    return { error: 400 };
  }
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const target = path.resolve(sourceRoot, relativePath);
  if (target !== sourceRoot && !target.startsWith(`${sourceRoot}${path.sep}`)) return { error: 403 };
  return { target };
}

function sendAppConfig(response) {
  const body = `window.APP_CONFIG = ${JSON.stringify({ apiBaseUrl: apiBaseUrl() })};\n`;
  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
    "Content-Type": "text/javascript; charset=utf-8",
  });
  response.end(body);
}

async function handler(request, response) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end("Method Not Allowed");
    return;
  }
  if (new URL(request.url ?? "/", "http://localhost").pathname === "/app-config.js") {
    if (request.method === "HEAD") {
      response.writeHead(200, { "Cache-Control": "no-store", "Content-Type": "text/javascript; charset=utf-8" });
      response.end();
    } else {
      sendAppConfig(response);
    }
    return;
  }
  const resolved = resolveFile(request.url);
  if (resolved.error) {
    response.writeHead(resolved.error, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(resolved.error === 404 ? "Not Found" : "Invalid path");
    return;
  }
  let stat;
  try {
    stat = await fs.promises.stat(resolved.target);
    if (!stat.isFile()) throw new Error("not a file");
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not Found");
    return;
  }
  response.writeHead(200, {
    "Cache-Control": "no-cache",
    "Content-Length": stat.size,
    "Content-Type": mimeTypes[path.extname(resolved.target).toLowerCase()] || "application/octet-stream",
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  fs.createReadStream(resolved.target).pipe(response);
}

export function createFrontendServer() {
  return http.createServer(handler);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await loadEnvFile(path.resolve(sourceRoot, "../.env.local"), { required: false });
  const { port, host } = frontendSettings();
  const server = createFrontendServer();
  server.listen(port, host, () => {
    console.log(JSON.stringify({ ok: true, url: `http://${host}:${port}`, root: sourceRoot }));
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
