import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { loadEnvFile } from "./config/env.mjs";
import { createApp } from "./app.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export async function startServer({ envFile = path.join(repositoryRoot, ".env.local"), env = process.env } = {}) {
  await loadEnvFile(envFile, { required: false });
  const app = createApp({ env });
  const server = app.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(app.config.port, app.config.host, resolve);
  });
  return { app, server };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { app, server } = await startServer();
  console.log(JSON.stringify({ ok: true, url: `http://${app.config.host}:${app.config.port}`, data_provider: app.config.data_provider }));
  const shutdown = () => server.close(() => process.exit(0));
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
