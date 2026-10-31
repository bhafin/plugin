import test from "node:test";
import assert from "node:assert/strict";
import { bundle, execute } from "../src/catalog.js";
const result = (name, args = {}) => execute(name, args).structuredContent;
test("catalog carries actual contract provenance and pagination", () => {
  const first = result("bharosa_docs_list", { limit: 1 });
  assert.equal(first.contractVersion, "API v1");
  assert.equal(first.documents.length, 1);
  assert.equal(first.nextOffset, 1);
  assert.equal(first.total, 111);
  assert.equal(result("bharosa_docs_list", { offset: 111 }).nextOffset, null);
  assert.match(first.documents[0].sourceSha256, /^[a-f0-9]{64}$/);
});
test("literal AND search is bounded and has predictable no-match behavior", () => {
  assert.ok(
    result("bharosa_docs_search", {
      query: "AUTHORIZATION account",
      limit: 20,
    }).matches.some((d) => d.id === "authentication"),
  );
  assert.equal(
    result("bharosa_docs_search", { query: "unlikely-no-match" }).total,
    0,
  );
  assert.equal(result("bharosa_docs_search", { query: ".*" }).total, 0);
  assert.ok(
    result("bharosa_docs_search", { query: "account", limit: 1 }).matches
      .length <= 1,
  );
});
test("chunked reads reassemble exact text with termination", () => {
  for (const doc of bundle.docs) {
    let offset = 0,
      text = "";
    do {
      const r = result("bharosa_docs_read", {
        id: doc.id,
        offset,
        maxChars: 71,
      });
      text += r.content;
      offset = r.nextOffset;
    } while (offset !== null);
    assert.equal(text, doc.content);
  }
});
test("invalid inputs never read arbitrary paths or return unbounded data", () => {
  for (const [name, args] of [
    ["bharosa_docs_read", { id: "../../.env" }],
    ["bharosa_docs_read", { id: "file:///etc/passwd" }],
    ["bharosa_docs_read", { id: "authentication", path: "/etc/passwd" }],
    ["bharosa_docs_read", { id: "missing" }],
    ["bharosa_docs_read", { id: "authentication", maxChars: 8001 }],
    ["bharosa_docs_read", { id: "authentication", offset: 30000 }],
    ["bharosa_docs_list", { offset: 112 }],
    ["bharosa_docs_list", { limit: 21 }],
    ["bharosa_docs_list", { limit: 1.5 }],
    ["bharosa_docs_search", { query: " ".repeat(2) }],
    ["bharosa_docs_search", { query: "a".repeat(121) }],
    ["bharosa_docs_list", { offset: -1 }],
    ["account_read", {}],
    ["__proto__", {}],
  ])
    assert.equal(execute(name, args).isError, true, JSON.stringify(args));
});

test("raw own keys and pre-trim query length cannot bypass validation", () => {
  for (const name of [
    "bharosa_docs_list",
    "bharosa_docs_search",
    "bharosa_docs_read",
  ]) {
    const valid =
      name === "bharosa_docs_list"
        ? {}
        : name === "bharosa_docs_search"
          ? { query: "OAuth" }
          : { id: "authentication" };
    for (const key of ["__proto__", "constructor", "prototype", "unknown"]) {
      const args = JSON.parse(JSON.stringify(valid));
      Object.defineProperty(args, key, {
        value: { polluted: true },
        enumerable: true,
      });
      assert.equal(execute(name, args).isError, true, name + ":" + key);
    }
  }
  assert.equal(
    execute("bharosa_docs_search", { query: " ".repeat(200) + "OAuth" })
      .isError,
    true,
  );
  assert.equal(
    execute("bharosa_docs_search", { query: "a".repeat(120) }).isError,
    undefined,
  );
  assert.deepEqual(
    result("bharosa_docs_search", { query: " OAuth " }),
    result("bharosa_docs_search", { query: "OAuth" }),
  );
  for (const value of [null, [], "", 0])
    assert.equal(execute("bharosa_docs_list", value).isError, true);
});

test("search ranks exact IDs and titles before body mentions deterministically", () => {
  for (const [query, id] of [
    ["authentication", "authentication"],
    ["errors", "errors"],
    ["create portfolio", "reference-create-portfolio"],
    ["schema-unit-input", "schema-unit-input"],
    ["UnitInput", "schema-unit-input"],
    ["OAuth", "oauth"],
  ]) {
    const found = result("bharosa_docs_search", { query });
    assert.equal(found.matches[0].id, id, query);
    assert.deepEqual(
      found,
      result("bharosa_docs_search", { query: query.toUpperCase() }),
    );
  }
  // No title contains these terms: equal body-only matches retain source order.
  const found = result("bharosa_docs_search", {
    query: "four fractional digits",
    limit: 20,
  });
  const indexes = found.matches.map((d) =>
    bundle.docs.findIndex((doc) => doc.id === d.id),
  );
  assert.deepEqual(
    indexes,
    [...indexes].sort((a, b) => a - b),
  );
});
