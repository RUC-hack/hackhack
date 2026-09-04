import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const legacyPath = path.join(repositoryRoot, "zhihuaccess.env");
const templatePath = path.join(repositoryRoot, ".env.example");
const targetPath = path.join(repositoryRoot, ".env.local");
const archiveDirectory = path.join(repositoryRoot, ".runtime", "secrets");

async function exists(filename) {
  try {
    await access(filename);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(legacyPath))) {
  console.log(JSON.stringify({ ok: true, migrated: false, reason: "legacy_file_not_found" }));
  process.exit(0);
}

const legacyText = (await readFile(legacyPath, "utf8")).trim();
const assignment = legacyText.match(/^ZHIHU_ACCESS_SECRET\s*=\s*(.+)$/);
const secret = assignment ? assignment[1].trim() : legacyText;
if (!secret || /[\r\n]/.test(secret)) throw new Error("Legacy secret file must contain one raw secret or one ZHIHU_ACCESS_SECRET assignment");

let envText = await readFile((await exists(targetPath)) ? targetPath : templatePath, "utf8");
if (!/^ZHIHU_ACCESS_SECRET=.*$/m.test(envText)) throw new Error("ZHIHU_ACCESS_SECRET key is missing from the environment template");
envText = envText.replace(/^ZHIHU_ACCESS_SECRET=.*$/m, `ZHIHU_ACCESS_SECRET=${secret}`);

await mkdir(archiveDirectory, { recursive: true });
const temporaryTarget = `${targetPath}.tmp`;
await writeFile(temporaryTarget, envText, { encoding: "utf8", mode: 0o600 });
await rename(temporaryTarget, targetPath);

const archivePath = path.join(archiveDirectory, `zhihuaccess-${Date.now()}.env.migrated`);
await rename(legacyPath, archivePath);
console.log(JSON.stringify({
  ok: true,
  migrated: true,
  target: ".env.local",
  archivedLegacyFile: path.relative(repositoryRoot, archivePath),
  secretPrinted: false,
}, null, 2));
