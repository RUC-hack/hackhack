import { asAppError, errorResponse, successResponse } from "../contracts/errors.mjs";

export function sendJson(response, status, payload, { origin = null } = {}) {
  const body = JSON.stringify(payload);
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  if (origin) response.setHeader("Access-Control-Allow-Origin", origin);
  response.end(body);
}

export function sendSuccess(response, data, requestId, options) {
  sendJson(response, 200, successResponse(data, requestId), options);
}

export function sendError(response, error, requestId, options) {
  const payload = errorResponse(error, requestId);
  sendJson(response, asAppError(error).status, payload, options);
}
