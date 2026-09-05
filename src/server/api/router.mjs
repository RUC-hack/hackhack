export function matchRoute(method, pathname) {
  const decoded = pathname.split("/").map((part) => {
    try { return decodeURIComponent(part); } catch { return part; }
  });
  if (method === "GET" && pathname === "/api/health") return { name: "health" };
  if (method === "POST" && pathname === "/api/sessions") return { name: "create_session" };
  if (method === "GET" && decoded.length === 4 && decoded[1] === "api" && decoded[2] === "sessions") return { name: "get_session", sessionId: decoded[3] };
  if (method === "POST" && decoded.length === 5 && decoded[1] === "api" && decoded[2] === "sessions" && decoded[4] === "messages") return { name: "post_message", sessionId: decoded[3] };
  if (method === "GET" && decoded.length === 4 && decoded[1] === "api" && decoded[2] === "sources") return { name: "get_source", sourceId: decoded[3] };
  return null;
}
