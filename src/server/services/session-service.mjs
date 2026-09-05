import { randomUUID } from "node:crypto";

import { appError } from "../contracts/errors.mjs";
import {
  assertSession,
  createSession,
  createUserMessage,
  publicSessionView,
} from "../contracts/session.mjs";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export class SessionService {
  constructor({ store, now = () => new Date(), idFactory = randomUUID, maxQuestions = 2 } = {}) {
    if (!store || typeof store.get !== "function" || typeof store.save !== "function") throw new TypeError("SessionService requires a session store");
    this.store = store;
    this.now = now;
    this.idFactory = idFactory;
    this.maxQuestions = maxQuestions;
  }

  async create({ problemStatement = "" } = {}) {
    const session = createSession({
      id: `session_${this.idFactory()}`,
      now: this.now,
      problemStatement,
      maxQuestions: this.maxQuestions,
    });
    if (typeof this.store.create === "function") await this.store.create(session);
    else await this.store.save(session);
    return session;
  }

  async get(sessionId) {
    const session = await this.store.get(sessionId);
    if (!session) throw appError("SESSION_NOT_FOUND");
    assertSession(session);
    return session;
  }

  async publicView(sessionId) {
    return publicSessionView(await this.get(sessionId));
  }

  async appendUserMessage(sessionId, { text, clientTurnId = null, updateProblemStatement = true } = {}) {
    const session = await this.get(sessionId);
    const message = createUserMessage({
      messageId: `message_${this.idFactory()}`,
      text,
      clientTurnId,
      now: this.now,
    });
    session.raw_messages.push(message);
    if (updateProblemStatement && !session.current_understanding.problem_statement) {
      session.current_understanding.problem_statement = message.text;
    }
    session.updated_at = this.now().toISOString();
    await this.store.save(session);
    return { session, message };
  }

  async save(session) {
    session.updated_at = this.now().toISOString();
    assertSession(session);
    return this.store.save(session);
  }

  async getTurnResult(session, clientTurnId) {
    if (!clientTurnId) return null;
    return session.turn_results?.[clientTurnId] ? clone(session.turn_results[clientTurnId]) : null;
  }

  async saveTurnResult(session, clientTurnId, result) {
    if (clientTurnId) {
      session.turn_results ??= {};
      session.turn_results[clientTurnId] = clone(result);
    }
    await this.save(session);
    return result;
  }
}
