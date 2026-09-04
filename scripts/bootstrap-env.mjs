import { access, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envTemplate = path.join(repositoryRoot, ".env.example");
const localEnv = path.join(repositoryRoot, ".env.local");
const runtimeStateTemplate = path.join(repositoryRoot, "config", "runtime-state.example.json");
const runtimeState = path.join(repositoryRoot, ".runtime", "state", "runtime-state.json");

async function exists(filename) {
  try {
    await access(filename);
    return true;
  } catch {
    return false;
  }
}

for (const directory of [
  ".runtime/state",
  ".runtime/cache",
  ".runtime/tmp",
  ".runtime/logs",
  ".runtime/experiments",
]) {
  await mkdir(path.join(repositoryRoot, directory), { recursive: true });
}

const actions = [];
if (await exists(localEnv)) {
  actions.push({ file: ".env.local", action: "kept_existing" });
} else {
  await copyFile(envTemplate, localEnv);
  actions.push({ file: ".env.local", action: "created_from_template" });
}

if (await exists(runtimeState)) {
  actions.push({ file: ".runtime/state/runtime-state.json", action: "kept_existing" });
} else {
  await copyFile(runtimeStateTemplate, runtimeState);
  actions.push({ file: ".runtime/state/runtime-state.json", action: "created_from_template" });
}

console.log(JSON.stringify({ ok: true, repositoryRoot, actions, next: "Fill secrets in .env.local, then run node scripts/env-doctor.mjs" }, null, 2));
process.exit(0);
