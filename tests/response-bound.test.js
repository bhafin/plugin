import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execute, bundle } from "../src/catalog.js";
import { boundResult, MAX_TOOL_RESULT_BYTES } from "../src/mcp-server.js";
test("serialized tool results have a universal byte bound and measured corpus maxima", () => {
  const coding = JSON.parse(
    readFileSync(new URL("../assets/coding.json", import.meta.url)),
  );
  const calls = [];
  for (let offset = 0; offset < 128; offset++)
    calls.push(["bharosa_docs_list", { offset, limit: 20 }]);
  for (const d of bundle.docs)
    for (let offset = 0; offset < d.content.length; offset += 8000)
      calls.push(["bharosa_docs_read", { id: d.id, offset, maxChars: 8000 }]);
  for (const op of coding.operations)
    calls.push(["bharosa_api_details", { operationId: op.id }]);
  for (const ex of coding.examples)
    for (let offset = 0; offset < ex.code.length; offset += 8000)
      calls.push([
        "bharosa_examples_read",
        { id: ex.id, offset, maxChars: 8000 },
      ]);
  const queries = new Set([
    "a",
    "e",
    "i",
    "o",
    "u",
    "account",
    "portfolio",
    "monthly",
    "authentication",
    ...coding.operations.map((x) => x.id),
    ...bundle.docs.map((x) => x.title),
  ]);
  for (const query of queries)
    for (const name of [
      "bharosa_docs_search",
      "bharosa_api_search",
      "bharosa_examples_search",
    ])
      calls.push([name, { query: query.slice(0, 120), limit: 20 }]);
  let max = 0,
    largest;
  for (const [name, args] of calls) {
    const r = execute(name, args);
    const bytes = Buffer.byteLength(JSON.stringify(r));
    if (bytes > max) {
      max = bytes;
      largest = { name, args };
    }
    assert.ok(bytes <= MAX_TOOL_RESULT_BYTES);
    assert.deepEqual(boundResult(r), r);
  }
  const oversized = boundResult({
    content: [{ type: "text", text: "🙂".repeat(MAX_TOOL_RESULT_BYTES) }],
  });
  assert.equal(oversized.isError, true);
  assert.ok(Buffer.byteLength(JSON.stringify(oversized)) < 2048);
  console.log(
    JSON.stringify({
      measuredCalls: calls.length,
      maxMeasuredResultBytes: max,
      largest,
      universalResultByteLimit: MAX_TOOL_RESULT_BYTES,
      scope:
        "all read chunks and API details; representative search queries, enforced cap covers all queries",
    }),
  );
});
