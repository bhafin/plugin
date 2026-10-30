import { createServer as createHttpServer } from "node:http";
import { isIP } from "node:net";
import { pathToFileURL } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./mcp-server.js";
import { createAdmission } from "./admission.js";

const MAX_BODY = 65536;
const METHODS = new Set([
  "initialize",
  "notifications/initialized",
  "ping",
  "tools/list",
  "tools/call",
]);

// Explicit stateless JSON transport: no sessions, event store, SSE or background jobs.
export function createHttpService({
  allowedHosts = ["localhost", "127.0.0.1"],
  allowedOrigins = [],
  maxConcurrent = 16,
  requestsPerMinute = 1200,
  burst = Math.min(requestsPerMinute, 120),
  clientRequestsPerMinute = 1200,
  clientBurst = 120,
  maxQueued = 128,
  maxQueuedPerClient = 112,
  maxActivePerClient = 8,
  maxQueueWaitMs = 15000,
  maxClients = 2048,
  trustAlb = false,
  requestTimeoutMs = 10000,
} = {}) {
  if (
    !allowedHosts.length ||
    allowedHosts.some((h) => !/^[a-z0-9.-]+(?::\d+)?$/i.test(h))
  )
    throw Error("Explicit host allowlist required");
  if (
    ![
      maxConcurrent,
      requestsPerMinute,
      requestTimeoutMs,
      burst,
      clientRequestsPerMinute,
      clientBurst,
      maxClients,
      maxQueued,
      maxQueuedPerClient,
      maxActivePerClient,
      maxQueueWaitMs,
    ].every((v) => Number.isInteger(v) && v > 0)
  )
    throw Error("Positive integer limits required");
  for (const origin of allowedOrigins) {
    if (new URL(origin).origin !== origin)
      throw Error("Origins must be exact origins");
  }
  const admission = createAdmission({
    maxConcurrent,
    requestsPerMinute,
    burst,
    clientRequestsPerMinute,
    clientBurst,
    maxClients,
    maxQueued,
    maxQueuedPerClient,
    maxActivePerClient,
    maxQueueWaitMs,
  });
  const reply = (res, status, message) => {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status, {
      "content-type": "application/json",
      ...(status === 429 || status === 503 ? { "retry-after": "1" } : {}),
    });
    res.end(JSON.stringify({ error: message }));
  };
  const http = createHttpServer({ maxHeaderSize: 8192 }, async (req, res) => {
    res.setHeader("cache-control", "no-store");
    res.setHeader("x-content-type-options", "nosniff");
    // ALB probes use a target-IP Host header. Health reveals no configuration or data.
    if (req.url === "/up" && req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(
        JSON.stringify({
          status: "ok",
          scope: "public-documentation",
          transport: "stateless-streamable-http",
          release: "http-0.3.0-sdk040",
        }),
      );
    }
    // Never trust forwarded host/IP headers from arbitrary callers.
    const host = req.headers.host?.toLowerCase();
    if (
      !host ||
      !/^[a-z0-9.-]+(?::[0-9]{1,5})?$/.test(host) ||
      !allowedHosts.some(
        (h) =>
          host === h.toLowerCase() ||
          (["localhost", "127.0.0.1"].includes(h.toLowerCase()) &&
            host.split(":")[0] === h.toLowerCase()) ||
          (!h.includes(":") && host === h.toLowerCase() + ":443"),
      )
    )
      return reply(res, 403, "Host is not allowed");
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.includes(origin))
      return reply(res, 403, "Origin is not allowed");
    if (origin) {
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("vary", "Origin");
    }
    if (req.headers.authorization || req.headers.cookie)
      return reply(
        res,
        400,
        "Public documentation service: do not send credentials or cookies",
      );
    if (req.url !== "/") return reply(res, 404, "Not found");
    if (req.method === "OPTIONS" && origin) {
      res.writeHead(204, {
        "access-control-allow-methods": "POST",
        "access-control-allow-headers":
          "content-type, accept, mcp-protocol-version",
        "access-control-max-age": "600",
      });
      return res.end();
    }
    if (req.method !== "POST") {
      res.setHeader("allow", "POST");
      return reply(res, 405, "Use POST; sessions and SSE are not supported");
    }
    if (
      !/^application\/json(?:\s*;.*)?$/i.test(req.headers["content-type"] ?? "")
    )
      return reply(res, 415, "Use application/json");
    if (
      req.headers["content-encoding"] &&
      req.headers["content-encoding"] !== "identity"
    )
      return reply(res, 415, "Compressed requests are not supported");
    if (req.headers["mcp-session-id"])
      return reply(res, 400, "This service is stateless; omit session IDs");
    if (Number(req.headers["content-length"]) > MAX_BODY)
      return reply(res, 413, "Request exceeds 65536 bytes");
    // Enable only behind an ALB in append mode with SG-enforced ALB-only ingress.
    // Rightmost XFF entry is appended by ALB; ignore attacker-controlled prefixes.
    const forwarded = req.headers["x-forwarded-for"];
    const clientIp = trustAlb
      ? typeof forwarded === "string"
        ? forwarded.split(",").at(-1).trim()
        : ""
      : req.socket.remoteAddress;
    if (!clientIp || !isIP(clientIp))
      return reply(res, 400, "Invalid client address");
    // Pause body consumption while queued. Node/socket buffers and connection count are bounded.
    req.pause();
    const cancellation = new AbortController();
    const cancel = () => cancellation.abort();
    res.once("close", cancel);
    const release = await admission.acquire(clientIp, cancellation.signal);
    res.off("close", cancel);
    if (!release)
      return reply(
        res,
        503,
        "Bounded admission queue is full or timed out; retry later",
      );
    if (res.destroyed || req.destroyed) {
      release();
      return;
    }
    req.resume();
    let server;
    let finished = false;
    const timer = setTimeout(() => {
      reply(res, 408, "Request timed out");
      req.destroy();
    }, requestTimeoutMs);
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      release();
      void server?.close().catch(() => {});
    };
    res.once("close", finish);
    try {
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY) {
          reply(res, 413, "Request exceeds 65536 bytes");
          return;
        }
        chunks.push(chunk);
      }
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        return reply(res, 400, "Invalid JSON");
      }
      if (
        !body ||
        Array.isArray(body) ||
        typeof body !== "object" ||
        body.jsonrpc !== "2.0" ||
        (typeof body.id === "string" && body.id.length > 128) ||
        !METHODS.has(body.method)
      )
        return reply(res, 400, "Unsupported JSON-RPC request");
      // Stateless requests cannot depend on initialization state retained on another replica.
      server = createServer({ requireInitialization: false });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch {
      reply(res, 500, "Documentation service could not process the request");
    } finally {
      if (res.writableEnded || res.destroyed) finish();
    }
  });
  http.requestTimeout = maxQueueWaitMs + requestTimeoutMs;
  http.maxConnections = 256;
  http.on("close", () => admission.close());
  http.headersTimeout = requestTimeoutMs;
  http.keepAliveTimeout = 5000;
  http.maxRequestsPerSocket = 100;
  http.on("clientError", (_error, socket) => {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });
  return http;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const port = Number(process.env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw Error("Invalid PORT");
  const http = createHttpService({
    trustAlb: process.env.MCP_TRUST_ALB === "true",
    allowedHosts: (
      process.env.MCP_ALLOWED_HOSTS ?? "localhost,127.0.0.1"
    ).split(","),
    allowedOrigins: process.env.MCP_ALLOWED_ORIGINS?.split(",") ?? [],
  });
  http.listen(port, process.env.MCP_BIND ?? "127.0.0.1", () =>
    console.error(
      "Bharosa HTTP documentation prototype listening; no account access",
    ),
  );
  const close = () => {
    http.close();
    http.closeIdleConnections();
    setTimeout(() => http.closeAllConnections(), 10000).unref();
  };
  process.once("SIGTERM", close);
  process.once("SIGINT", close);
}
