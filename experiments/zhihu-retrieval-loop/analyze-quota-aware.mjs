import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const token = argv[index];
    const value = argv[index + 1];
    if (!token?.startsWith("--") || !value) throw new Error("Arguments must use --name value pairs");
    args[token.slice(2)] = value;
  }
  return args;
}

function readJsonLines(text, source) {
  return text.split(/\r?\n/u).filter((line) => line.trim()).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid JSON in ${source} at line ${index + 1}: ${error.message}`);
    }
  });
}

function ratio(numerator, denominator) {
  return denominator === 0 ? null : Math.round((numerator / denominator) * 10_000) / 10_000;
}

function usableValue(row) {
  if (typeof row.usable === "boolean") return row.usable;
  const values = [row.relevance, row.lived_experience, row.evidence_sufficiency];
  return values.every(Number.isFinite) ? values.every((value) => value >= 1) : null;
}

const args = parseArgs(process.argv.slice(2));
if (!args.results) throw new Error("--results is required");
const resultsPath = path.resolve(args.results);
const rows = readJsonLines(await readFile(resultsPath, "utf8"), resultsPath);
const successful = rows.filter((row) => row.business_ok);
const rateLimited = rows.filter((row) => row.response?.Code === 30001);
const otherFailures = rows.filter((row) => !row.business_ok && row.response?.Code !== 30001);
const items = successful.flatMap((row) => row.response?.Data?.Items ?? []);

let manual = null;
if (args.annotations) {
  const annotationFiles = args.annotations.split(",").map((value) => path.resolve(value.trim()));
  const annotations = [];
  for (const annotationPath of annotationFiles) {
    annotations.push(...readJsonLines(await readFile(annotationPath, "utf8"), annotationPath));
  }
  const completed = annotations.filter((row) => usableValue(row) !== null);
  const byStrategy = {};
  for (const strategy of new Set(completed.map((row) => row.strategy ?? row.condition))) {
    const strategyRows = completed.filter((row) => (row.strategy ?? row.condition) === strategy);
    const cases = {};
    for (const caseId of new Set(strategyRows.map((row) => row.case_id))) {
      const caseRows = strategyRows.filter((row) => row.case_id === caseId);
      const usable = caseRows.filter((row) => usableValue(row)).length;
      cases[caseId] = {
        annotated_items: caseRows.length,
        usable_items: usable,
        usable_precision: ratio(usable, caseRows.length),
      };
    }
    const usable = strategyRows.filter((row) => usableValue(row)).length;
    byStrategy[strategy] = {
      annotated_items: strategyRows.length,
      usable_items: usable,
      usable_precision: ratio(usable, strategyRows.length),
      cases,
    };
  }
  manual = {
    completed_annotations: completed.length,
    incomplete_annotations: annotations.length - completed.length,
    by_strategy: byStrategy,
  };
}

const report = {
  schema_version: "1.0",
  analysis_type: "quota-aware",
  results_path: resultsPath,
  censoring: {
    rate_limit_observed: rateLimited.length > 0,
    first_rate_limited_request_index: rateLimited[0]?.request_index ?? null,
    reliability_rate_is_estimable: rateLimited.length === 0,
    note: rateLimited.length > 0
      ? "Code 30001 rows are reported separately and excluded from content-quality denominators."
      : null,
  },
  calls: {
    executed: rows.length,
    successful: successful.length,
    rate_limited: rateLimited.length,
    other_failures: otherFailures.length,
  },
  successful_response_quality: {
    evaluated_calls: successful.length,
    schema_valid_calls: successful.filter((row) => row.schema_valid).length,
    schema_valid_rate: ratio(successful.filter((row) => row.schema_valid).length, successful.length),
    empty_calls: successful.filter((row) => row.item_count === 0).length,
    returned_items: items.length,
    mean_items_per_success: successful.length === 0 ? null : items.length / successful.length,
  },
  manual,
};

if (args.out) await writeFile(path.resolve(args.out), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
