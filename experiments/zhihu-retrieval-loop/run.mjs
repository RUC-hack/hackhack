import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const envFile = path.resolve(process.env.HACKHACK_ENV_FILE ?? path.join(repositoryRoot, ".env.local"));

try {
  const text = await readFile(envFile, "utf8");
  for (const originalLine of text.split(/\r?\n/)) {
    const line = originalLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    let value = rawValue.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
} catch (error) {
  if (error.code === "ENOENT") {
    console.error(`Missing ${envFile}. Run: node scripts/bootstrap-env.mjs`);
    process.exit(2);
  }
  throw error;
}

await import("./run-search.mjs");
