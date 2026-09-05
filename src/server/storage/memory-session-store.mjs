import { assertSession, cloneSession } from "../contracts/session.mjs";

export class MemorySessionStore {
  constructor() {
    this.sessions = new Map();
  }

  async create(session) {
    assertSession(session);
    if (this.sessions.has(session.session_id)) throw new Error(`Session already exists: ${session.session_id}`);
    this.sessions.set(session.session_id, cloneSession(session));
    return cloneSession(session);
  }

  async get(sessionId) {
    const session = this.sessions.get(sessionId);
    return session ? cloneSession(session) : null;
  }

  async save(session) {
    assertSession(session);
    this.sessions.set(session.session_id, cloneSession(session));
    return cloneSession(session);
  }

  async delete(sessionId) {
    this.sessions.delete(sessionId);
  }
}
