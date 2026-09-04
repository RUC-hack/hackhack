import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const token = argv[i];
    if (!token?.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${token}`);
    args[token.slice(2)] = value;
  }
  return args;
}

function readJsonLines(text) {
  return text.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid JSON on line ${index + 1}: ${error.message}`);
    }
  });
}

function ratio(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}

function round(value, digits = 4) {
  if (value === null || Number.isNaN(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function percentile(values, probability) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(probability * sorted.length) - 1)];
}

function wilson(successes, total, z = 1.96) {
  if (total === 0) return { low: null, high: null };
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denominator;
  const margin = (z / denominator) * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
  return { low: round(center - margin), high: round(center + margin) };
}

function itemRows(results, topK = 5) {
  const seen = new Set();
  const rows = [];
  for (const result of results.filter((row) => row.attempt === 1 && row.business_ok)) {
    const items = result.response?.Data?.Items ?? [];
    for (let index = 0; index < Math.min(topK, items.length); index += 1) {
      const item = items[index];
      const annotationKey = `${result.case_id}|${result.strategy}|${item.Url}`;
      if (seen.has(annotationKey)) continue;
      seen.add(annotationKey);
      rows.push({
        annotation_key: annotationKey,
        rater_id: "",
        case_id: result.case_id,
        strategy: result.strategy,
        query_id: result.query_id,
        query: result.query,
        rank: index + 1,
        title: item.Title ?? "",
        author: item.AuthorName ?? "",
        content_text: item.ContentText ?? "",
        url: item.Url ?? "",
        relevance: null,
        lived_experience: null,
        evidence_sufficiency: null,
        path_label: "",
        usable: null,
        notes: "",
      });
    }
  }
  return rows;
}

function automaticMetrics(results) {
  const total = results.length;
  const transportSuccess = results.filter((row) => row.transport_ok).length;
  const businessSuccess = results.filter((row) => row.business_ok).length;
  const schemaValid = results.filter((row) => row.schema_valid).length;
  const successful = results.filter((row) => row.business_ok);
  const latencies = results.map((row) => row.latency_ms).filter(Number.isFinite);
  const allItems = successful.flatMap((row) => row.response?.Data?.Items ?? []);
  const required = ["Title", "ContentType", "ContentID", "ContentText", "Url", "VoteUpCount", "AuthorName", "AuthorityLevel", "RankingScore"];
  let missingFields = 0;
  for (const item of allItems) {
    for (const field of required) if (!(field in item)) missingFields += 1;
  }

  const urlGroups = new Map();
  for (const row of successful) {
    const key = `${row.case_id}|${row.strategy}`;
    const urls = urlGroups.get(key) ?? [];
    urls.push(...(row.response?.Data?.Items ?? []).map((item) => item.Url).filter(Boolean));
    urlGroups.set(key, urls);
  }
  const duplicateRatios = [...urlGroups.values()]
    .map((urls) => ratio(urls.length - new Set(urls).size, urls.length))
    .filter((value) => value !== null);

  const repeats = new Map();
  for (const row of successful) {
    const key = `${row.case_id}|${row.strategy}|${row.query_id}`;
    const attempts = repeats.get(key) ?? [];
    attempts.push(new Set((row.response?.Data?.Items ?? []).map((item) => item.Url).filter(Boolean)));
    repeats.set(key, attempts);
  }
  const jaccards = [];
  for (const attempts of repeats.values()) {
    if (attempts.length < 2) continue;
    for (const current of attempts.slice(1)) {
      const reference = attempts[0];
      const intersection = [...reference].filter((url) => current.has(url)).length;
      const union = new Set([...reference, ...current]).size;
      jaccards.push(ratio(intersection, union));
    }
  }

  return {
    total_calls: total,
    transport_success_rate: round(ratio(transportSuccess, total)),
    business_success_rate: round(ratio(businessSuccess, total)),
    business_success_wilson_95: wilson(businessSuccess, total),
    schema_valid_rate: round(ratio(schemaValid, total)),
    empty_success_rate: round(ratio(successful.filter((row) => row.item_count === 0).length, successful.length)),
    latency_ms: {
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      max: latencies.length ? Math.max(...latencies) : null,
    },
    mean_items_per_success: round(ratio(allItems.length, successful.length)),
    missing_required_field_rate: round(ratio(missingFields, allItems.length * required.length)),
    mean_duplicate_url_ratio_within_case: round(mean(duplicateRatios)),
    mean_repeat_jaccard: round(mean(jaccards)),
  };
}

function usableValue(annotation) {
  if (typeof annotation.usable === "boolean") return annotation.usable;
  const ratings = [annotation.relevance, annotation.lived_experience, annotation.evidence_sufficiency];
  if (ratings.every(Number.isFinite)) return ratings.every((value) => value >= 1);
  return null;
}

function manualMetrics(annotations) {
  const completed = annotations.filter((row) => usableValue(row) !== null);
  const strategies = {};
  for (const strategy of new Set(completed.map((row) => row.strategy))) {
    const rows = completed.filter((row) => row.strategy === strategy);
    const casePaths = new Map();
    for (const row of rows) {
      if (!row.path_label) continue;
      const labels = casePaths.get(row.case_id) ?? new Set();
      labels.add(row.path_label);
      casePaths.set(row.case_id, labels);
    }
    strategies[strategy] = {
      annotated_items: rows.length,
      usable_precision_at_5: round(mean(rows.map((row) => usableValue(row) ? 1 : 0))),
      mean_relevance: round(mean(rows.map((row) => row.relevance).filter(Number.isFinite))),
      mean_lived_experience: round(mean(rows.map((row) => row.lived_experience).filter(Number.isFinite))),
      mean_evidence_sufficiency: round(mean(rows.map((row) => row.evidence_sufficiency).filter(Number.isFinite))),
      mean_distinct_paths_per_case: round(mean([...casePaths.values()].map((labels) => labels.size))),
      cases_with_at_least_two_paths_rate: round(ratio([...casePaths.values()].filter((labels) => labels.size >= 2).length, casePaths.size)),
    };
  }

  const byKey = new Map();
  for (const row of completed) {
    const values = byKey.get(row.annotation_key) ?? [];
    values.push(usableValue(row));
    byKey.set(row.annotation_key, values);
  }
  const pairs = [...byKey.values()].filter((values) => values.length === 2);
  let agreement = null;
  let kappa = null;
  if (pairs.length) {
    agreement = mean(pairs.map(([a, b]) => a === b ? 1 : 0));
    const pA = mean(pairs.map(([a]) => a ? 1 : 0));
    const pB = mean(pairs.map(([, b]) => b ? 1 : 0));
    const expected = pA * pB + (1 - pA) * (1 - pB);
    kappa = expected === 1 ? 1 : (agreement - expected) / (1 - expected);
  }
  return {
    completed_annotations: completed.length,
    strategies,
    inter_rater: {
      paired_items: pairs.length,
      raw_agreement: round(agreement),
      cohens_kappa_usable: round(kappa),
    },
  };
}

const args = parseArgs(process.argv.slice(2));
if (!args.results) throw new Error("--results is required");
const resultsPath = path.resolve(args.results);
const results = readJsonLines(await readFile(resultsPath, "utf8"));

if (args["prepare-annotations"]) {
  const output = path.resolve(args["prepare-annotations"]);
  const rows = itemRows(results, 5);
  await writeFile(output, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
  console.error(`Wrote ${rows.length} annotation rows to ${output}`);
}

let annotations = [];
if (args.annotations) {
  for (const filename of args.annotations.split(",")) {
    annotations.push(...readJsonLines(await readFile(path.resolve(filename), "utf8")));
  }
}

const report = {
  schema_version: "1.0",
  results_path: resultsPath,
  automatic: automaticMetrics(results),
  manual: annotations.length ? manualMetrics(annotations) : null,
};
if (args.out) await writeFile(path.resolve(args.out), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
