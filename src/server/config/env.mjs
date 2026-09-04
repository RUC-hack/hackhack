import { readFile } from "node:fs/promises";
import path from "node:path";

export async function loadEnvFile(filePath, { override = false, required = false } = {}) {
  const resolvedPath = path.resolve(filePath);
  let text;
  try {
    text = await readFile(resolvedPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT" && !required) {
      return { loaded: false, path: resolvedPath, keys: [] };
    }
    throw error;
  }

  const keys = [];
  for (const originalLine of text.split(/\r?\n/u)) {
    const line = originalLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;

    const key = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) continue;

    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2
      && ((value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }

    if (override || process.env[key] === undefined) {
      process.env[key] = value;
      keys.push(key);
    }
  }

  return { loaded: true, path: resolvedPath, keys };
}

export function envBoolean(value, fallback = false) {
  if (value === undefined || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`Expected a boolean environment value, received: ${value}`);
}

export function envInteger(value, fallback, { minimum, maximum, name = "value" } = {}) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) throw new Error(`${name} must be an integer`);
  if (minimum !== undefined && parsed < minimum) throw new Error(`${name} must be >= ${minimum}`);
  if (maximum !== undefined && parsed > maximum) throw new Error(`${name} must be <= ${maximum}`);
  return parsed;
}
