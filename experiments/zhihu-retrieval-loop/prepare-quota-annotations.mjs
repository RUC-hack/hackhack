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

const args = parseArgs(process.argv.slice(2));
if (!args.results || !args.output) throw new Error("--results and --output are required");

const resultsPath = path.resolve(args.results);
const outputPath = path.resolve(args.output);
const results = readJsonLines(await readFile(resultsPath, "utf8"), resultsPath);
const seen = new Set();
const annotations = [];

for (const result of results.filter((row) => row.business_ok)) {
  const items = result.response?.Data?.Items ?? [];
  for (let index = 0; index < Math.min(5, items.length); index += 1) {
    const item = items[index];
    const annotationKey = `${result.case_id}|${result.strategy}|${item.Url}`;
    if (seen.has(annotationKey)) continue;
    seen.add(annotationKey);
    annotations.push({
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

await writeFile(outputPath, `${annotations.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
console.error(`Wrote ${annotations.length} annotation rows to ${outputPath}`);
