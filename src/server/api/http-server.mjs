import http from "node:http";

export function createHttpServer(handler) {
  return http.createServer(handler);
}
