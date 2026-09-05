import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { assertSourceDocument, sourcePublicView } from "../contracts/source-document.mjs";

function fileName(sourceId) {
  return `${Buffer.from(sourceId, "utf8").toString("base64url")}.json`;
}

export class SourceStore {
  constructor({ directory = null } = {}) {
    this.directory = directory ? path.resolve(directory) : null;
    this.sources = new Map();
  }

  async save(source) {
    assertSourceDocument(source);
    const stored = JSON.parse(JSON.stringify(source));
    this.sources.set(stored.source_id, stored);
    if (this.directory) {
      await mkdir(this.directory, { recursive: true });
      await writeFile(path.join(this.directory, fileName(stored.source_id)), `${JSON.stringify(stored)}\n`, "utf8");
    }
    return JSON.parse(JSON.stringify(stored));
  }

  async saveMany(sources) {
    const stored = [];
    for (const source of sources) stored.push(await this.save(source));
    return stored;
  }

  async get(sourceId) {
    if (this.sources.has(sourceId)) return JSON.parse(JSON.stringify(this.sources.get(sourceId)));
    if (!this.directory) return null;
    try {
      const source = JSON.parse(await readFile(path.join(this.directory, fileName(sourceId)), "utf8"));
      assertSourceDocument(source);
      this.sources.set(source.source_id, source);
      return JSON.parse(JSON.stringify(source));
    } catch (error) {
      if (error?.code === "ENOENT" || error instanceof SyntaxError || error instanceof TypeError) return null;
      throw error;
    }
  }

  async getPublic(sourceId) {
    const source = await this.get(sourceId);
    return source ? sourcePublicView(source) : null;
  }

  async list() {
    if (this.directory) {
      try {
        for (const entry of await readdir(this.directory)) {
          if (!entry.endsWith(".json")) continue;
          try {
            const source = JSON.parse(await readFile(path.join(this.directory, entry), "utf8"));
            assertSourceDocument(source);
            this.sources.set(source.source_id, source);
          } catch {
            // Ignore one damaged source; callers can still use the valid index.
          }
        }
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
    return [...this.sources.values()].map((source) => JSON.parse(JSON.stringify(source)));
  }
}
