import { randomUUID } from "node:crypto";

export const SESSION_STATES = Object.freeze([
  "COLLECTING_CONTEXT",
  "READY_FOR_RETRIEVAL",
  "RETRIEVING",
  "REVIEWING_EVIDENCE",
  "PRESENTING",
  "WAITING_FOR_FOLLOW_UP",
  "CONFIRMING_TOPIC",
  "SAFETY_HANDLING",
  "FAILED_RECOVERABLE",
]);

export const STATE_TRANSITIONS = Object.freeze({
  COLLECTING_CONTEXT: Object.freeze(["COLLECTING_CONTEXT", "READY_FOR_RETRIEVAL", "RETRIEVING", "PRESENTING", "CONFIRMING_TOPIC", "SAFETY_HANDLING", "FAILED_RECOVERABLE"]),
  READY_FOR_RETRIEVAL: Object.freeze(["READY_FOR_RETRIEVAL", "RETRIEVING", "PRESENTING", "COLLECTING_CONTEXT", "CONFIRMING_TOPIC", "SAFETY_HANDLING", "FAILED_RECOVERABLE"]),
  RETRIEVING: Object.freeze(["RETRIEVING", "REVIEWING_EVIDENCE", "PRESENTING", "WAITING_FOR_FOLLOW_UP", "FAILED_RECOVERABLE", "SAFETY_HANDLING"]),
  REVIEWING_EVIDENCE: Object.freeze(["REVIEWING_EVIDENCE", "PRESENTING", "WAITING_FOR_FOLLOW_UP", "FAILED_RECOVERABLE"]),
  PRESENTING: Object.freeze(["PRESENTING", "WAITING_FOR_FOLLOW_UP", "COLLECTING_CONTEXT", "RETRIEVING", "CONFIRMING_TOPIC", "SAFETY_HANDLING", "FAILED_RECOVERABLE"]),
  WAITING_FOR_FOLLOW_UP: Object.freeze(["WAITING_FOR_FOLLOW_UP", "COLLECTING_CONTEXT", "RETRIEVING", "PRESENTING", "CONFIRMING_TOPIC", "SAFETY_HANDLING", "FAILED_RECOVERABLE"]),
  CONFIRMING_TOPIC: Object.freeze(["CONFIRMING_TOPIC", "COLLECTING_CONTEXT", "SAFETY_HANDLING", "FAILED_RECOVERABLE"]),
  SAFETY_HANDLING: Object.freeze(["SAFETY_HANDLING", "COLLECTING_CONTEXT", "RETRIEVING", "PRESENTING", "CONFIRMING_TOPIC"]),
  FAILED_RECOVERABLE: Object.freeze(["FAILED_RECOVERABLE", "COLLECTING_CONTEXT", "RETRIEVING", "SAFETY_HANDLING"]),
});

const STATE_SET = new Set(SESSION_STATES);

function clone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

export function createSession({
  id = `session_${randomUUID()}`,
  now = () => new Date(),
  problemStatement = "",
  maxQuestions = 2,
} = {}) {
  const createdAt = now().toISOString();
  return {
    schema_version: "1.0",
    session_id: id,
    status: "COLLECTING_CONTEXT",
    created_at: createdAt,
    updated_at: createdAt,
    context_version: 1,
    question_count: 0,
    max_questions: maxQuestions,
    raw_messages: [],
    current_understanding: {
      problem_statement: String(problemStatement ?? "").trim(),
      context_items: [],
      blocking_unknowns: [],
      assumptions: [],
      contradictions: [],
    },
    retrievals: [],
    evidence_packets: [],
    answer_history: [],
    current_answer: null,
    pending_question: null,
    pending_topic: null,
    turn_results: {},
  };
}

export function assertSession(session) {
  if (!session || typeof session !== "object" || Array.isArray(session)) throw new TypeError("Session must be an object");
  if (typeof session.session_id !== "string" || !session.session_id) throw new TypeError("Session.session_id is required");
  if (!STATE_SET.has(session.status)) throw new TypeError(`Unknown session status: ${session.status}`);
  if (!Number.isInteger(session.context_version) || session.context_version < 1) throw new TypeError("Session.context_version is invalid");
  if (!Array.isArray(session.raw_messages)) throw new TypeError("Session.raw_messages must be an array");
  if (!Array.isArray(session.retrievals) || !Array.isArray(session.evidence_packets) || !Array.isArray(session.answer_history)) {
    throw new TypeError("Session history fields must be arrays");
  }
  return session;
}

export function canTransition(from, to) {
  return STATE_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from, to) {
  if (!canTransition(from, to)) throw new TypeError(`Illegal session transition: ${from} -> ${to}`);
  return true;
}

export function createUserMessage({
  messageId = `message_${randomUUID()}`,
  text,
  now = () => new Date(),
  clientTurnId = null,
} = {}) {
  const normalized = typeof text === "string" ? text.trim() : "";
  if (!normalized) throw new TypeError("User message text must be non-empty");
  return {
    message_id: messageId,
    role: "user",
    text: normalized,
    created_at: now().toISOString(),
    ...(clientTurnId ? { client_turn_id: clientTurnId } : {}),
  };
}

export function publicSessionView(session) {
  assertSession(session);
  const view = clone(session);
  delete view.turn_results;
  return view;
}

export function isTerminalPresentationState(status) {
  return status === "PRESENTING" || status === "WAITING_FOR_FOLLOW_UP";
}

export { clone as cloneSession };
