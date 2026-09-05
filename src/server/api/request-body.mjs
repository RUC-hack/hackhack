import { appError } from "../contracts/errors.mjs";

export async function readJsonBody(request, { maxBytes = 64 * 1024 } = {}) {
  const contentType = String(request.headers["content-type"] ?? "").split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") throw appError("CONTENT_TYPE_REQUIRED");
  const declaredLength = Number(request.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw appError("REQUEST_TOO_LARGE");
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) throw appError("REQUEST_TOO_LARGE");
    chunks.push(chunk);
  }
  if (total === 0) throw appError("INVALID_REQUEST", { message: "Request body is required" });
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    throw appError("INVALID_REQUEST", { message: "Request body must be valid JSON", cause: error });
  }
}
