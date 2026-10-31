import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { request } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const { createHttpService } = await import(
  process.env.BHAROSA_HTTP_MODULE ?? "../src/http-server.js"
);

async function fixture(options = {}, endpoint = "/") {
  const server = createHttpService({
    requestsPerMinute: 1000,
    clientRequestsPerMinute: 1000,
    clientBurst: 1000,
    ...options,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = new URL(`http://127.0.0.1:${server.address().port}${endpoint}`);
  return {
    server,
    url,
    close: async () => {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    },
  };
}
const headers = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};
const rpc = (method, params = {}, id = 1) => ({
  jsonrpc: "2.0",
  id,
  method,
  params,
});

for (const endpoint of ["/"])
  test(`HTTP SDK client negotiates and calls all seven tools with provenance at ${endpoint}`, async () => {
    const f = await fixture({}, endpoint);
    const client = new Client({ name: "local-http-verifier", version: "1" });
    try {
      await client.connect(new StreamableHTTPClientTransport(f.url));
      assert.equal(client.getServerVersion().title, "Bharosa");
      const tools = (await client.listTools()).tools;
      assert.equal(tools.length, 7);
      assert.ok(
        tools.every(
          (t) =>
            t.name.startsWith("bharosa_") &&
            t.title &&
            t.annotations.title === t.title &&
            t.annotations.readOnlyHint,
        ),
      );
      const call = async (name, args) => {
        const r = await client.callTool({ name, arguments: args });
        assert.ok(!r.isError, JSON.stringify(r));
        return r.structuredContent;
      };
      const docs = await call("bharosa_docs_list", {});
      assert.equal(docs.total, 111);
      await call("bharosa_docs_search", { query: "authentication" });
      const doc = await call("bharosa_docs_read", { id: "authentication" });
      assert.ok(JSON.stringify(doc).includes("source"));
      const apis = await call("bharosa_api_search", { query: "portfolio" });
      const operation = apis.matches[0].id;
      await call("bharosa_api_details", { operationId: operation });
      const examples = await call("bharosa_examples_search", {
        query: "portfolio",
      });
      await call("bharosa_examples_read", { id: examples.matches[0].id });
      const bad = await client.callTool({
        name: "bharosa_docs_read",
        arguments: { id: "../../etc/passwd" },
      });
      assert.equal(bad.isError, true);
    } finally {
      await client.close();
      await f.close();
    }
  });

for (const endpoint of ["/"])
  test(`HTTP boundaries reject cross-origin, hostile host, credentials, paths and oversized input at ${endpoint}`, async () => {
    const f = await fixture(
      { allowedOrigins: ["https://example.test"] },
      endpoint,
    );
    const send = (body, extra = {}, method = "POST", path = endpoint) =>
      fetch(new URL(path, f.url), {
        method,
        headers: { ...headers, ...extra },
        ...(method === "POST"
          ? { body: typeof body === "string" ? body : JSON.stringify(body) }
          : {}),
      });
    try {
      const hostile = await new Promise((resolve, reject) => {
        const r = request(
          f.url,
          { method: "POST", headers: { ...headers, host: "evil.test" } },
          (res) => {
            res.resume();
            resolve(res.statusCode);
          },
        );
        r.on("error", reject);
        r.end(JSON.stringify(rpc("tools/list")));
      });
      assert.equal(hostile, 403);
      for (const removed of ["/mcp", "/healthz"]) {
        assert.equal(
          (await send(rpc("tools/list"), {}, "POST", removed)).status,
          404,
        );
        assert.equal((await send(null, {}, "GET", removed)).status, 404);
      }
      const cases = [
        [rpc("tools/list"), { origin: "https://evil.test" }, 403],
        [rpc("tools/list"), { origin: "null" }, 403],
        [rpc("tools/list"), { authorization: "Bearer synthetic" }, 400],
        [rpc("tools/list"), { cookie: "synthetic=1" }, 400],
        [rpc("tools/list"), { "content-type": "text/plain" }, 415],
        [rpc("tools/list"), { "content-encoding": "gzip" }, 415],
        [rpc("tools/list"), { "mcp-session-id": "synthetic" }, 400],
        ["{", {}, 400],
        [[], {}, 400],
        [rpc("resources/read"), {}, 400],
        ["x".repeat(65537), {}, 413],
      ];
      for (const [body, extra, status] of cases) {
        const r = await send(body, extra);
        assert.equal(r.status, status);
        assert.ok((await r.text()).length < 200);
      }
      for (const method of ["GET", "DELETE", "PUT"])
        assert.equal((await send(null, {}, method)).status, 405);
      assert.equal(
        (await send(rpc("tools/list"), {}, "POST", "/mcp?secret=1")).status,
        404,
      );
      const preflight = await send(
        null,
        { origin: "https://example.test" },
        "OPTIONS",
      );
      assert.equal(preflight.status, 204);
      assert.equal(
        preflight.headers.get("access-control-allow-origin"),
        "https://example.test",
      );
      const valid = await send(rpc("tools/list"));
      assert.equal(valid.status, 200);
      assert.equal(valid.headers.get("mcp-session-id"), null);
      for (const args of [
        '{"query":"' + " ".repeat(121) + 'x"}',
        '{"query":"x","__proto__":{}}',
        '{"query":"x","constructor":{}}',
      ]) {
        const r = await send(
          '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"bharosa_docs_search","arguments":' +
            args +
            "}}",
        );
        assert.equal((await r.json()).result.isError, true);
      }
      assert.equal(
        (
          await send(rpc("tools/list"), {
            "mcp-protocol-version": "1900-01-01",
          })
        ).status,
        400,
      );
      assert.equal(
        (await send(rpc("tools/list"), { accept: "text/plain" })).status,
        406,
      );
      for (const path of ["/up"]) {
        const health = await send(null, {}, "GET", path);
        assert.equal(health.status, 200);
        assert.equal(health.headers.get("cache-control"), "no-store");
        assert.equal(
          (await send(rpc("tools/list"), {}, "POST", path)).status,
          404,
        );
      }
      assert.equal(
        (await send(rpc("tools/list"), {}, "POST", "/?secret=1")).status,
        404,
      );
    } finally {
      await f.close();
    }
  });

test("HTTP global admission limit and concurrent slow-body bound", async () => {
  const f = await fixture({ requestsPerMinute: 1, maxQueueWaitMs: 50 });
  try {
    const opts = {
      method: "POST",
      headers,
      body: JSON.stringify(rpc("tools/list")),
    };
    assert.equal((await fetch(f.url, opts)).status, 200);
    const limited = await fetch(f.url, opts);
    assert.equal(limited.status, 503);
    assert.equal(limited.headers.get("retry-after"), "1");
  } finally {
    await f.close();
  }
  const g = await fixture({ maxConcurrent: 1, requestTimeoutMs: 200 });
  const slow = request(g.url, {
    method: "POST",
    headers: { ...headers, "transfer-encoding": "chunked" },
  });
  slow.on("error", () => {});
  slow.write("{");
  try {
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(
      (
        await fetch(g.url, {
          method: "POST",
          headers,
          body: JSON.stringify(rpc("tools/list")),
        })
      ).status,
      200,
    );
    await new Promise((r) => setTimeout(r, 250));
    assert.equal(
      (
        await fetch(g.url, {
          method: "POST",
          headers,
          body: JSON.stringify(rpc("tools/list")),
        })
      ).status,
      200,
    );
  } finally {
    slow.destroy();
    await g.close();
  }
});

test("HTTP protocol versions, concurrent determinism and dangerous keys across every tool", async () => {
  const f = await fixture();
  const post = async (body, protocol = "2025-11-25") => {
    const r = await fetch(f.url, {
      method: "POST",
      headers: { ...headers, "mcp-protocol-version": protocol },
      body: JSON.stringify(body),
    });
    assert.equal(r.status, 200);
    return r.json();
  };
  try {
    for (const protocol of ["2025-11-25", "2025-06-18", "2024-11-05"]) {
      const initialized = await post(
        rpc("initialize", {
          protocolVersion: protocol,
          capabilities: {},
          clientInfo: { name: "fixture", version: "1" },
        }),
        protocol,
      );
      assert.equal(initialized.result.protocolVersion, protocol);
    }
    const valid = {
      bharosa_docs_list: {},
      bharosa_docs_search: { query: "OAuth" },
      bharosa_docs_read: { id: "authentication" },
      bharosa_api_search: { query: "account" },
      bharosa_api_details: { operationId: "retrieve_account" },
      bharosa_examples_search: { query: "retrieve" },
      bharosa_examples_read: { id: "sdk-account-retrieve-account" },
    };
    for (const [name, args] of Object.entries(valid)) {
      for (const key of ["__proto__", "constructor", "prototype", "unknown"]) {
        const malicious = { ...args };
        Object.defineProperty(malicious, key, { value: {}, enumerable: true });
        assert.equal(
          (await post(rpc("tools/call", { name, arguments: malicious }))).result
            .isError,
          true,
        );
      }
    }
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        post(
          rpc("tools/call", {
            name: "bharosa_docs_search",
            arguments: { query: "OAuth" },
          }),
        ),
      ),
    );
    for (const result of results) assert.deepEqual(result, results[0]);
    assert.equal({}.polluted, undefined);
  } finally {
    await f.close();
  }
});

test("public host normalization and ALB client buckets reject spoofing and stay bounded", async () => {
  const f = await fixture({
    allowedHosts: ["mcp.bharosa.finance"],
    trustAlb: true,
    clientBurst: 1,
    clientRequestsPerMinute: 1,
    maxClients: 2,
    maxQueueWaitMs: 50,
  });
  const send = (host, xff) =>
    new Promise((resolve, reject) => {
      const r = request(
        f.url,
        {
          method: "POST",
          headers: {
            ...headers,
            host,
            ...(xff ? { "x-forwarded-for": xff } : {}),
          },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      r.on("error", reject);
      r.end(JSON.stringify(rpc("tools/list")));
    });
  try {
    assert.equal(await send("MCP.BHAROSA.FINANCE:443", "198.51.100.1"), 200);
    assert.equal(
      await send("mcp.bharosa.finance", "203.0.113.1, 198.51.100.1"),
      503,
    );
    assert.equal(await send("mcp.bharosa.finance", "198.51.100.2"), 200);
    assert.equal(await send("mcp.bharosa.finance", "198.51.100.3"), 503);
    for (const host of [
      "mcp.bharosa.finance:80",
      "mcp.bharosa.finance:1234",
      "mcp.bharosa.finance:garbage",
      "mcp.bharosa.finance.",
      "mcp.bharosa.finance.evil.test",
    ])
      assert.equal(await send(host, "198.51.100.4"), 403);
    assert.equal(await send("mcp.bharosa.finance", "bad"), 400);
    assert.equal(await send("mcp.bharosa.finance"), 400);
  } finally {
    await f.close();
  }
  const g = await fixture({
    clientBurst: 1,
    clientRequestsPerMinute: 1,
    maxQueueWaitMs: 50,
  });
  try {
    for (const [ip, expected] of [
      ["198.51.100.1", 200],
      ["198.51.100.2", 503],
    ]) {
      const r = await fetch(g.url, {
        method: "POST",
        headers: { ...headers, "x-forwarded-for": ip },
        body: JSON.stringify(rpc("tools/list")),
      });
      assert.equal(r.status, expected);
    }
  } finally {
    await g.close();
  }
});

test(
  "30 and 100 synthetic attendees recover through fixed instance capacity",
  { timeout: 120000 },
  async () => {
    for (const attendeeCount of [30, 100]) {
      const replicas = await Promise.all([
        fixture({
          requestsPerMinute: 1200,
          burst: 120,
          clientRequestsPerMinute: 300,
          clientBurst: 60,
          trustAlb: true,
        }),
        fixture({
          requestsPerMinute: 1200,
          burst: 120,
          clientRequestsPerMinute: 300,
          clientBurst: 60,
          trustAlb: true,
        }),
      ]);
      if (process.env.BHAROSA_EVENT_REPLICAS === "1")
        await replicas.pop().close();
      const started = Date.now();
      let completed = 0;
      let retried = 0;
      try {
        await Promise.all(
          Array.from({ length: attendeeCount }, async (_, i) => {
            for (let n = 0; n < 10; n++) {
              for (let attempt = 0; ; attempt++) {
                assert.ok(attempt < 90, "bounded retry exhaustion");
                const response = await fetch(
                  replicas[i % replicas.length].url,
                  {
                    method: "POST",
                    headers: {
                      ...headers,
                      "x-forwarded-for": `198.51.100.${i + 1}`,
                    },
                    body: JSON.stringify(
                      rpc("tools/call", {
                        name: "bharosa_docs_search",
                        arguments: { query: "account" },
                      }),
                    ),
                  },
                );
                if (response.status === 429 || response.status === 503) {
                  assert.equal(response.headers.get("retry-after"), "1");
                  await response.text();
                  retried++;
                  await new Promise((r) => setTimeout(r, 1000 + (i % 7) * 11));
                  continue;
                }
                assert.equal(response.status, 200);
                assert.ok(!(await response.json()).result.isError);
                completed++;
                break;
              }
            }
          }),
        );
        assert.equal(completed, attendeeCount * 10);
        console.log(
          JSON.stringify({
            syntheticAttendees: attendeeCount,
            replicas: replicas.length,
            completed,
            retried,
            durationMs: Date.now() - started,
            scope:
              "local loopback with explicit retry; not Fargate or actual host throughput",
          }),
        );
      } finally {
        await Promise.all(replicas.map((r) => r.close()));
      }
    }
  },
);
