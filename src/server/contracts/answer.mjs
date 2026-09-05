const FORBIDDEN_STATISTICAL_PATTERNS = [
  /成功率/u,
  /成功概率/u,
  /概率是?\s*\d+/u,
  /\d+\s*%\s*(成功|概率)/u,
];

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function containsForbiddenStatistics(value) {
  if (typeof value === "string") return FORBIDDEN_STATISTICAL_PATTERNS.some((pattern) => pattern.test(value));
  if (Array.isArray(value)) return value.some(containsForbiddenStatistics);
  if (isObject(value)) return Object.values(value).some(containsForbiddenStatistics);
  return false;
}

export function validateAgentDecision(decision) {
  const errors = [];
  const actions = new Set(["ask", "retrieve", "respond", "confirm_topic", "safety"]);
  if (!isObject(decision)) return { valid: false, errors: ["decision_not_object"] };
  if (!actions.has(decision.action)) errors.push("action_invalid");
  if (typeof decision.reason !== "string" || !decision.reason.trim()) errors.push("reason_required");
  if (decision.blocking_unknowns !== undefined && !Array.isArray(decision.blocking_unknowns)) errors.push("blocking_unknowns_must_be_array");
  if (decision.queries !== undefined && !Array.isArray(decision.queries)) errors.push("queries_must_be_array");
  if (decision.action === "ask") {
    if (!isObject(decision.question) || typeof decision.question.text !== "string" || !decision.question.text.trim()) errors.push("question_required");
  }
  if (decision.action === "retrieve") {
    if (!Array.isArray(decision.queries) || decision.queries.length < 1 || decision.queries.length > 8) errors.push("retrieve_queries_invalid");
    if ((decision.queries ?? []).some((query) => typeof query !== "string" || !query.trim() || query.length > 200)) errors.push("retrieve_query_invalid");
  } else if ((decision.queries ?? []).length > 0) {
    errors.push("queries_only_allowed_for_retrieve");
  }
  if (decision.state_patch !== undefined && !isObject(decision.state_patch)) errors.push("state_patch_must_be_object");
  if (decision.state_patch && ["raw_messages", "retrievals", "evidence_packets", "answer_history", "turn_results", "session_id"].some((field) => field in decision.state_patch)) {
    errors.push("state_patch_mutates_protected_fields");
  }
  if (containsForbiddenStatistics(decision)) errors.push("decision_contains_forbidden_statistics");
  return { valid: errors.length === 0, errors };
}

export function assertAgentDecision(decision) {
  const validation = validateAgentDecision(decision);
  if (!validation.valid) throw new TypeError(`AgentDecision is invalid: ${validation.errors.join(", ")}`);
  return decision;
}

export function validateAnswerEnvelope(answer, { sourceIds = null } = {}) {
  const errors = [];
  if (!isObject(answer)) return { valid: false, errors: ["answer_not_object"] };
  if (typeof answer.summary !== "string") errors.push("summary_must_be_string");
  if (!Array.isArray(answer.sections)) errors.push("sections_must_be_array");
  for (const [index, section] of (answer.sections ?? []).entries()) {
    if (!isObject(section)) {
      errors.push(`section_${index}_not_object`);
      continue;
    }
    if (typeof section.kind !== "string" || !section.kind.trim()) errors.push(`section_${index}_kind_required`);
    if (typeof section.title !== "string") errors.push(`section_${index}_title_must_be_string`);
    if (section.source_ids !== undefined && !Array.isArray(section.source_ids)) errors.push(`section_${index}_source_ids_must_be_array`);
    if (sourceIds && (section.source_ids ?? []).some((sourceId) => !sourceIds.has(sourceId))) errors.push(`section_${index}_source_id_not_found`);
    if (section.content === undefined) errors.push(`section_${index}_content_required`);
  }
  for (const field of ["assumptions", "unknowns", "limitations", "next_actions"]) {
    if (answer[field] !== undefined && !Array.isArray(answer[field])) errors.push(`${field}_must_be_array`);
  }
  if (containsForbiddenStatistics(answer)) errors.push("answer_contains_forbidden_statistics");
  return { valid: errors.length === 0, errors };
}

export function assertAnswerEnvelope(answer, options) {
  const validation = validateAnswerEnvelope(answer, options);
  if (!validation.valid) throw new TypeError(`AnswerEnvelope is invalid: ${validation.errors.join(", ")}`);
  return answer;
}

export { FORBIDDEN_STATISTICAL_PATTERNS };
