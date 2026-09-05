import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();

function parseEnv(text) {
  const values = [];
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const separator = line.indexOf("=");
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (/(SECRET|API_KEY|TOKEN|PASSWORD)/iu.test(key) && value.length >= 8) values.push(value);
  }
  return values;
}

const exactSecrets = [];
for (const filename of [".env.local", ".env.zhihu-5000.local", ".env"]) {
  try { exactSecrets.push(...parseEnv(await readFile(path.join(root, filename), "utf8"))); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}

const staged = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"], { cwd: root })
  .toString("utf8").split("\0").filter(Boolean);
const findings = [];
for (const relative of staged) {
  let text;
  try { text = await readFile(path.join(root, relative), "utf8"); }
  catch { continue; }
  for (const secret of exactSecrets) {
    if (text.includes(secret)) findings.push({ file: relative, rule: "exact_local_secret" });
  }
  if (/\bsk-[A-Za-z0-9_-]{20,}\b/gu.test(text)) findings.push({ file: relative, rule: "api_key_shape" });
  if (/Authorization["']?\s*[:=]\s*["']Bearer\s+[A-Za-z0-9._~-]{20,}/giu.test(text)) findings.push({ file: relative, rule: "authorization_header_value" });
}

console.log(JSON.stringify({ staged_files_scanned: staged.length, findings }, null, 2));
if (findings.length > 0) process.exitCode = 1;

