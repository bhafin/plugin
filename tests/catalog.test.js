import test from "node:test";
import assert from "node:assert/strict";
import { bundle, execute } from "../src/catalog.js";
const result = (name, args = {}) => execute(name, args).structuredContent;
test("catalog carries actual contract provenance and pagination", () => {
  const first = result("docs_list", { limit: 1 });
  assert.equal(first.contractVersion, "API v1");
  assert.equal(first.documents.length, 1);
  assert.equal(first.nextOffset, 1);
  assert.equal(first.total, 96);
  assert.equal(result("docs_list", { offset: 96 }).nextOffset, null);
  assert.match(first.documents[0].sourceSha256, /^[a-f0-9]{64}$/);
});
test("literal AND search is bounded and has predictable no-match behavior", () => {
  assert.ok(
    result("docs_search", {
      query: "AUTHORIZATION account",
      limit: 20,
    }).matches.some((d) => d.id === "authentication"),
  );
  assert.equal(result("docs_search", { query: "unlikely-no-match" }).total, 0);
  assert.equal(result("docs_search", { query: ".*" }).total, 0);
  assert.ok(
    result("docs_search", { query: "account", limit: 1 }).matches.length <= 1,
  );
});
test("chunked reads reassemble exact text with termination", () => {
  for (const doc of bundle.docs) {
    let offset = 0,
      text = "";
    do {
      const r = result("docs_read", { id: doc.id, offset, maxChars: 71 });
      text += r.content;
      offset = r.nextOffset;
    } while (offset !== null);
    assert.equal(text, doc.content);
  }
});
test("invalid inputs never read arbitrary paths or return unbounded data", () => {
  for (const [name, args] of [
    ["docs_read", { id: "../../.env" }],
    ["docs_read", { id: "file:///etc/passwd" }],
    ["docs_read", { id: "authentication", path: "/etc/passwd" }],
    ["docs_read", { id: "missing" }],
    ["docs_read", { id: "authentication", maxChars: 8001 }],
    ["docs_read", { id: "authentication", offset: 30000 }],
    ["docs_list", { offset: 97 }],
    ["docs_list", { limit: 21 }],
    ["docs_list", { limit: 1.5 }],
    ["docs_search", { query: " ".repeat(2) }],
    ["docs_search", { query: "a".repeat(121) }],
    ["docs_list", { offset: -1 }],
    ["account_read", {}],
    ["__proto__", {}],
  ])
    assert.equal(execute(name, args).isError, true, JSON.stringify(args));
});

test("raw own keys and pre-trim query length cannot bypass validation", () => {
  for (const name of ["docs_list", "docs_search", "docs_read"]) {
    const valid =
      name === "docs_list"
        ? {}
        : name === "docs_search"
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
    execute("docs_search", { query: " ".repeat(200) + "OAuth" }).isError,
    true,
  );
  assert.equal(
    execute("docs_search", { query: "a".repeat(120) }).isError,
    undefined,
  );
  assert.deepEqual(
    result("docs_search", { query: " OAuth " }),
    result("docs_search", { query: "OAuth" }),
  );
  for (const value of [null, [], "", 0])
    assert.equal(execute("docs_list", value).isError, true);
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
    const found = result("docs_search", { query });
    assert.equal(found.matches[0].id, id, query);
    assert.deepEqual(
      found,
      result("docs_search", { query: query.toUpperCase() }),
    );
  }
  // No title contains these terms: equal body-only matches retain source order.
  const found = result("docs_search", {
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
