import { readFile } from "node:fs/promises";

import { appError } from "../contracts/errors.mjs";
import { assertSourceDocument } from "../contracts/source-document.mjs";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function score(document, query) {
  const terms = query.toLowerCase().split(/\s+/u).filter(Boolean);
  const haystack = `${document.title} ${document.summary} ${document.author}`.toLowerCase();
  return terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
}

export class LocalDatasetProvider {
  constructor({ datasetPath = "data/experiences.jsonl", dataset = null, now = () => new Date() } = {}) {
    this.datasetPath = datasetPath;
    this.dataset = dataset;
    this.dataset?.forEach(assertSourceDocument);
    this.now = now;
    this.name = "local";
  }

  status() {
    return { provider: "local", configured: Boolean(this.dataset || this.datasetPath), live_calls_allowed: false };
  }

  async #load() {
    if (this.dataset) return this.dataset;
    let content;
    try {
      content = await readFile(this.datasetPath, "utf8");
    } catch (error) {
      throw appError("LOCAL_DATASET_UNAVAILABLE", { cause: error });
    }
    const records = [];
    for (const [index, line] of content.split(/\r?\n/u).entries()) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line);
        assertSourceDocument(record);
        records.push(record);
      } catch (error) {
        throw appError("LOCAL_DATASET_UNAVAILABLE", {
          details: { line: index + 1 },
          cause: error,
        });
      }
    }
    this.dataset = records;
    return records;
  }

  async search(query, { limit = 10, requestId = null, signal } = {}) {
    if (signal?.aborted) throw appError("RETRIEVAL_FAILED", { message: "Retrieval was cancelled", retryable: false });
    if (typeof query !== "string" || !query.trim()) throw appError("INVALID_REQUEST", { message: "query must be a non-empty string" });
    const records = await this.#load();
    const ranked = records
      .map((document, index) => ({ document, index, score: score(document, query) }))
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .filter((item) => item.score > 0 || records.length <= limit)
      .slice(0, limit)
      .map(({ document }) => document);
    return {
      documents: clone(ranked),
      meta: {
        provider: "local",
        request_id: requestId,
        cached: false,
        retrieved_at: this.now().toISOString(),
        result_count: ranked.length,
      },
    };
  }
}
