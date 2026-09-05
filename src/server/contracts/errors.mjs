const ERROR_DEFAULTS = Object.freeze({
  INVALID_REQUEST: { status: 400, retryable: false, message: "Request is invalid" },
  CONTENT_TYPE_REQUIRED: { status: 415, retryable: false, message: "Content-Type must be application/json" },
  REQUEST_TOO_LARGE: { status: 413, retryable: false, message: "Request body is too large" },
  SESSION_NOT_FOUND: { status: 404, retryable: false, message: "Session does not exist" },
  SOURCE_NOT_FOUND: { status: 404, retryable: false, message: "Source does not exist" },
  NOT_FOUND: { status: 404, retryable: false, message: "Route does not exist" },
  METHOD_NOT_ALLOWED: { status: 405, retryable: false, message: "Method is not allowed" },
  LLM_NOT_CONFIGURED: { status: 503, retryable: true, message: "Language model is not configured" },
  LLM_INVALID_RESPONSE: { status: 502, retryable: false, message: "Language model returned an invalid response" },
  LLM_CONTENT_FILTER: { status: 502, retryable: false, message: "Language model filtered the requested content" },
  LLM_OUTPUT_TRUNCATED: { status: 502, retryable: false, message: "Language model output was truncated" },
  LLM_TIMEOUT: { status: 504, retryable: true, message: "Language model request timed out" },
  LLM_NETWORK_ERROR: { status: 502, retryable: true, message: "Language model request failed" },
  LLM_CANCELLED: { status: 499, retryable: false, message: "Request was cancelled" },
  RETRIEVAL_FAILED: { status: 503, retryable: true, message: "Experience retrieval failed" },
  LOCAL_DATASET_UNAVAILABLE: { status: 503, retryable: true, message: "Local experience dataset is unavailable" },
  EVIDENCE_INVALID: { status: 502, retryable: false, message: "Retrieved evidence is invalid" },
  SOURCE_SELECTION_INVALID: { status: 502, retryable: false, message: "Selected source candidates are invalid" },
  ANSWER_INVALID: { status: 502, retryable: false, message: "Generated answer is invalid" },
  ANALYSIS_IN_PROGRESS: { status: 409, retryable: true, message: "The current source analysis is still in progress" },
  SAFETY_HANDLING: { status: 200, retryable: false, message: "The request needs a safety response" },
  INTERNAL_ERROR: { status: 500, retryable: false, message: "Internal server error" },
});

export class AppError extends Error {
  constructor(message, {
    code = "INTERNAL_ERROR",
    status,
    retryable,
    details = null,
    cause,
  } = {}) {
    super(message, { cause });
    this.name = "AppError";
    this.code = code;
    this.status = status ?? ERROR_DEFAULTS[code]?.status ?? 500;
    this.retryable = retryable ?? ERROR_DEFAULTS[code]?.retryable ?? false;
    this.details = details;
  }

  toPublicJSON() {
    return {
      code: this.code,
      message: ERROR_DEFAULTS[this.code]?.message ?? this.message,
      retryable: this.retryable,
    };
  }
}

export function appError(code, options = {}) {
  const defaults = ERROR_DEFAULTS[code] ?? ERROR_DEFAULTS.INTERNAL_ERROR;
  return new AppError(options.message ?? defaults.message, {
    ...options,
    code,
    status: options.status ?? defaults.status,
    retryable: options.retryable ?? defaults.retryable,
  });
}

export function asAppError(error, fallbackCode = "INTERNAL_ERROR") {
  if (error instanceof AppError) return error;
  if (ERROR_DEFAULTS[error?.code]) {
    return new AppError(error.message ?? ERROR_DEFAULTS[error.code].message, {
      code: error.code,
      status: error.status ?? ERROR_DEFAULTS[error.code].status,
      retryable: error.retryable ?? ERROR_DEFAULTS[error.code].retryable,
      details: error.details ?? null,
      cause: error,
    });
  }
  if (typeof error?.code === "string" && error.code.startsWith("ZHIHU_")) {
    return new AppError(error.message, {
      code: error.code,
      status: error.code === "ZHIHU_RATE_LIMITED" ? 429 : error.code === "ZHIHU_INVALID_ARGUMENT" ? 400 : 502,
      retryable: Boolean(error.retryable),
      details: { provider_code: error.providerCode ?? null },
      cause: error,
    });
  }
  return appError(fallbackCode, { cause: error });
}

export function errorResponse(error, requestId) {
  const safe = asAppError(error);
  return {
    ok: false,
    data: null,
    error: safe.toPublicJSON(),
    request_id: requestId,
  };
}

export function successResponse(data, requestId) {
  return { ok: true, data, error: null, request_id: requestId };
}

export { ERROR_DEFAULTS };
