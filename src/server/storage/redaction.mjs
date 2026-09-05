const SENSITIVE_KEY = /(secret|api[_-]?key|token|authorization|password|cookie|credential|auth[_-]?code|prompt)/iu;
const SENSITIVE_VALUE = /(?:bearer\s+|sk-[a-z0-9_-]{8,}|(?:access[_ -]?secret|api[_ -]?key|oauth[_ -]?token|authorization\s*code)\s*[=:]\s*)[^\s,;]+/giu;
const SAFE_TOKEN_METRIC_KEY = /^(?:prompt|completion|total)_tokens$/iu;

function isSafeTokenMetric(key, value) {
  return SAFE_TOKEN_METRIC_KEY.test(key) && (typeof value === "number" || /^\d+$/u.test(String(value)));
}

export function redactString(value) {
  return String(value).replace(SENSITIVE_VALUE, "[REDACTED]");
}

export function redact(value, { key = "" } = {}) {
  if (SENSITIVE_KEY.test(key) && !isSafeTokenMetric(key, value)) return "[REDACTED]";
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redact(childValue, { key: childKey })]));
  }
  return value;
}
