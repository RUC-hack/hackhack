import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { redact } from "./redaction.mjs";

function safePart(value, fallback = "unknown") {
  const normalized = String(value ?? fallback).replace(/[^A-Za-z0-9_.-]/gu, "_");
  return normalized || fallback;
}

export class AuditLogger {
  constructor({ logDir = "logs", now = () => new Date(), strict = false, onWarning = () => {} } = {}) {
    this.logDir = path.resolve(logDir);
    this.now = now;
    this.strict = strict;
    this.onWarning = onWarning;
  }

  async log(event = {}) {
    const recordedAt = event.recorded_at ?? this.now().toISOString();
    const sessionId = event.session_id ?? "system";
    const date = recordedAt.slice(0, 10);
    const directory = path.join(this.logDir, "conversations", date);
    const filename = `session-${safePart(sessionId)}.jsonl`;
    const record = redact({
      schema_version: "1.0",
      recorded_at: recordedAt,
      ...event,
    });
    try {
      await mkdir(directory, { recursive: true });
      await appendFile(path.join(directory, filename), `${JSON.stringify(record)}\n`, "utf8");
      return { written: true, record };
    } catch (error) {
      try { this.onWarning({ code: "AUDIT_LOG_WRITE_FAILED", cause: error }); } catch { /* warning hooks cannot change business behavior */ }
      if (this.strict) throw error;
      return { written: false, record };
    }
  }
}
