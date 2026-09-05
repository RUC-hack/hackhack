import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { validateAnswerEnvelope } from "../../src/server/contracts/answer.mjs";
import { extractFirstJsonObject } from "./deepseek-json-client.mjs";

function normalizeText(value) {
  if (typeof value === "string") return value.replace(/成功概率|成功率/gu, "结果的不确定性");
  if (Array.isArray(value)) return value.map(normalizeText);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeText(item)]));
  return value;
}

function normalizeAnswer(value) {
  const answer = normalizeText(value);
  for (const field of ["assumptions", "unknowns", "limitations", "next_actions"]) {
    if (answer[field] === undefined || answer[field] === null) answer[field] = [];
    else if (!Array.isArray(answer[field])) answer[field] = [String(answer[field])];
  }
  return answer;
}

const [inputArg, outputArg] = process.argv.slice(2);
if (!inputArg || !outputArg) throw new Error("Usage: node recover-v3-output.mjs <input.jsonl> <output.jsonl>");
const input = path.resolve(inputArg);
const output = path.resolve(outputArg);
const rows = (await readFile(input, "utf8")).split(/\r?\n/u).filter(Boolean).map(JSON.parse);
for (const row of rows) {
  if (row.ok || !row.selection_validation?.valid) continue;
  const selectedIds = new Set(row.selection.selected_source_ids);
  const attempt = [...(row.error?.attempts ?? [])].reverse().find((item) => item.raw_content);
  if (!attempt) continue;
  try {
    const recovered = normalizeAnswer(extractFirstJsonObject(attempt.raw_content));
    const validation = validateAnswerEnvelope(recovered, { sourceIds: selectedIds });
    row.recovery = { applied: true, steps: ["coerce_list_fields", "replace_forbidden_metric_terms"], validation };
    if (validation.valid) {
      row.answer = recovered;
      row.answer_validation = validation;
      row.original_error = row.error;
      delete row.error;
      row.ok = true;
    }
  } catch (error) {
    row.recovery = { applied: true, validation: { valid: false, errors: [error.message] } };
  }
}
await writeFile(output, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
const summary = { rows: rows.length, successful: rows.filter((row) => row.ok).length, recovered: rows.filter((row) => row.recovery?.validation?.valid).length };
console.log(JSON.stringify(summary, null, 2));
if (summary.successful !== summary.rows) process.exitCode = 1;
