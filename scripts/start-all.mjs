import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { loadEnvFile } from "../src/server/config/env.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await loadEnvFile(path.join(repositoryRoot, ".env.local"), { required: false });
const childEnvironment = { ...process.env };
const children = [
  spawn(process.execPath, [path.join(repositoryRoot, "src/server/main.mjs")], { cwd: repositoryRoot, env: childEnvironment, stdio: "inherit" }),
  spawn(process.execPath, [path.join(repositoryRoot, "scripts/frontend-server.mjs")], { cwd: repositoryRoot, env: childEnvironment, stdio: "inherit" }),
];
let shuttingDown = false;
let startupComplete = false;
let rejectStartup;
const startupFailure = new Promise((_, reject) => { rejectStartup = reject; });

function localUrl(host, port, pathname) {
  const checkHost = ["0.0.0.0", "::", "[::]"].includes(host) ? "127.0.0.1" : host;
  return `http://${checkHost}:${port}${pathname}`;
}

async function waitForReady(url, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "未响应";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) {
        if (label === "backend") {
          const payload = await response.json();
          if (payload?.ok && payload?.data?.status === "ok") return;
          lastError = "健康检查返回异常";
        } else {
          return;
        }
      } else {
        lastError = `HTTP ${response.status}`;
      }
    } catch (error) {
      lastError = error?.message || "未响应";
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`${label} 启动超时（${lastError}）`);
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  setTimeout(() => process.exit(code), 300);
}

for (const [index, child] of children.entries()) {
  const label = index === 0 ? "backend" : "frontend";
  child.once("error", (error) => {
    const failure = new Error(`${label} 进程启动失败：${error.code || error.message}`);
    if (!startupComplete && !shuttingDown) rejectStartup(failure);
    else if (!shuttingDown) shutdown(1);
  });
  child.once("exit", (code, signal) => {
    if (shuttingDown) return;
    if (!startupComplete) {
      rejectStartup(new Error(`${label} 进程提前退出：${signal || `exit ${code}`}`));
    } else if (signal || code !== 0) {
      shutdown(code || 1);
    }
  });
}
process.once("SIGINT", () => shutdown(0));
process.once("SIGTERM", () => shutdown(0));

try {
  const appHost = process.env.APP_HOST || "127.0.0.1";
  const appPort = process.env.APP_PORT || 3000;
  const frontendHost = process.env.FRONTEND_HOST || "127.0.0.1";
  const frontendPort = process.env.FRONTEND_PORT || 8080;
  await Promise.race([
    Promise.all([
      waitForReady(localUrl(appHost, appPort, "/api/health"), "backend"),
      waitForReady(localUrl(frontendHost, frontendPort, "/"), "frontend"),
    ]),
    startupFailure,
  ]);
  startupComplete = true;
  console.log(JSON.stringify({
    ok: true,
    ready: true,
    backend: `http://${appHost}:${appPort}`,
    frontend: `http://${frontendHost}:${frontendPort}`,
  }));
} catch (error) {
  console.error(JSON.stringify({ ok: false, ready: false, error: "STARTUP_FAILED", message: error.message }));
  shutdown(1);
}
