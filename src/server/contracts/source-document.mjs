const REQUIRED_FIELDS = Object.freeze([
  "source_id",
  "title",
  "author",
  "summary",
  "url",
  "content_type",
  "retrieved_at",
  "provider",
]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validateSourceDocument(document) {
  const errors = [];
  if (!isPlainObject(document)) return { valid: false, errors: ["source_not_object"] };
  for (const field of REQUIRED_FIELDS) {
    if (typeof document[field] !== "string") errors.push(`${field}_must_be_string`);
  }
  if (typeof document.url === "string" && document.url) {
    try {
      const url = new URL(document.url);
      if (url.protocol !== "https:") errors.push("url_must_be_https");
    } catch {
      errors.push("url_must_be_url");
    }
  }
  if (typeof document.retrieved_at === "string" && Number.isNaN(Date.parse(document.retrieved_at))) {
    errors.push("retrieved_at_must_be_iso_date");
  }
  if (typeof document.summary === "string" && /<[^>]+>/u.test(document.summary)) {
    errors.push("summary_must_be_plain_text");
  }
  return { valid: errors.length === 0, errors };
}

export function assertSourceDocument(document) {
  const validation = validateSourceDocument(document);
  if (!validation.valid) {
    throw new TypeError(`SourceDocument is invalid: ${validation.errors.join(", ")}`);
  }
  return document;
}

export function sourcePublicView(document) {
  assertSourceDocument(document);
  return {
    source_id: document.source_id,
    title: document.title,
    author: document.author,
    summary: document.summary,
    url: document.url,
    content_type: document.content_type,
    retrieved_at: document.retrieved_at,
    provider: document.provider,
    ...(document.metadata ? { metadata: document.metadata } : {}),
  };
}

export { REQUIRED_FIELDS };
