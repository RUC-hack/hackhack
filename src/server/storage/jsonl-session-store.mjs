import { appendFile, mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { assertSession, cloneSession } from "../contracts/session.mjs";
import { redact } from "./redaction.mjs";

function safePart(value) {
  return String(value).replace(/[^A-Za-z0-9_.-]/gu, "_");
}

export class JsonlSessionStore {
  constructor({ logDir = "logs", now = () => new Date() } = {}) {
    this.logDir = path.resolve(logDir);
    this.now = now;
    this.cache = new Map();
  }

  #filePath(sessionId, date) {
    return path.join(this.logDir, "conversations", date, `session-${safePart(sessionId)}.jsonl`);
  }

  async create(session) {
    assertSession(session);
    if (await this.get(session.session_id)) throw new Error(`Session already exists: ${session.session_id}`);
    return this.save(session, { eventType: "session_created" });
  }

  async get(sessionId) {
    if (this.cache.has(sessionId)) return cloneSession(this.cache.get(sessionId));
    const root = path.join(this.logDir, "conversations");
    let dates;
    try {
      dates = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
    const candidates = dates.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse();
    for (const date of candidates) {
      let content;
      try {
        content = await readFile(this.#filePath(sessionId, date), "utf8");
      } catch (error) {
        if (error?.code === "ENOENT") continue;
        throw error;
      }
      const lines = content.trim().split(/\r?\n/u).filter(Boolean);
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        try {
          const event = JSON.parse(lines[index]);
          if (["session_snapshot", "session_created", "session_updated"].includes(event.event_type) && event.session) {
            assertSession(event.session);
            this.cache.set(sessionId, cloneSession(event.session));
            return cloneSession(event.session);
          }
        } catch {
          // A truncated last line must not make older snapshots unavailable.
        }
      }
    }
    return null;
  }

  async save(session, { eventType = "session_updated" } = {}) {
    assertSession(session);
    const snapshot = cloneSession(session);
    const date = snapshot.updated_at?.slice(0, 10) || this.now().toISOString().slice(0, 10);
    const directory = path.dirname(this.#filePath(snapshot.session_id, date));
    await mkdir(directory, { recursive: true });
    await appendFile(this.#filePath(snapshot.session_id, date), `${JSON.stringify({
      schema_version: "1.0",
      event_type: eventType,
      recorded_at: this.now().toISOString(),
      session_id: snapshot.session_id,
      session: redact(snapshot),
    })}\n`, "utf8");
    this.cache.set(snapshot.session_id, snapshot);
    return cloneSession(snapshot);
  }
}
