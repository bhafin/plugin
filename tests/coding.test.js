import test from "node:test";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { codingBundle } from "../src/coding-catalog.js";
import { execute, inputs, bundle } from "../src/catalog.js";
const result = (name, args) => {
  const r = execute(name, args);
  assert.ok(!r.isError, JSON.stringify(r));
  return r.structuredContent;
};
test("all canonical operations and examples have resolvable bounded tool results", () => {
  assert.equal(Object.keys(inputs).length, 7);
  for (const op of codingBundle.operations) {
    const r = result("bharosa_api_details", { operationId: op.id });
    assert.deepEqual(r.operation, op);
    for (const id of r.schemaDocumentIds)
      assert.ok(
        bundle.docs.some((d) => d.id === id),
        id,
      );
    assert.equal(
      result("bharosa_api_search", { query: op.id }).matches[0].id,
      op.id,
    );
  }
  for (const e of codingBundle.examples) {
    let code = "",
      offset = 0;
    do {
      const r = result("bharosa_examples_read", {
        id: e.id,
        offset,
        maxChars: 97,
      });
      code += r.code;
      offset = r.nextOffset;
    } while (offset !== null);
    assert.equal(code, e.code);
    const found = result("bharosa_examples_search", {
      query: e.id,
      language: e.language,
    });
    assert.equal(found.matches[0].id, e.id);
  }
});
test("new tools reject dangerous keys, paths, raw overflow and unknown operations", () => {
  const cases = {
    bharosa_api_search: { query: "portfolio" },
    bharosa_api_details: { operationId: codingBundle.operations[0].id },
    bharosa_examples_search: { query: "portfolio" },
    bharosa_examples_read: { id: codingBundle.examples[0].id },
  };
  for (const [name, args] of Object.entries(cases))
    for (const key of ["__proto__", "constructor", "path", "url"]) {
      const raw = JSON.parse(
        JSON.stringify(args).slice(0, -1) + `,"${key}":"/etc/passwd"}`,
      );
      assert.equal(execute(name, raw).isError, true);
    }
  for (const name of ["bharosa_api_search", "bharosa_examples_search"]) {
    assert.equal(
      execute(name, { query: " ".repeat(121) + "portfolio" }).isError,
      true,
    );
    assert.deepEqual(
      result(name, { query: "portfolio" }),
      result(name, { query: "PORTFOLIO" }),
    );
  }
  for (const [name, args] of [
    ["bharosa_api_details", { operationId: "../../secret" }],
    ["bharosa_api_details", { operationId: "unknown" }],
    ["bharosa_examples_read", { id: "../../secret" }],
    ["bharosa_examples_read", { id: "missing" }],
    [
      "bharosa_examples_read",
      { id: codingBundle.examples[0].id, offset: 30000 },
    ],
    ["docs_list", {}],
  ])
    assert.equal(execute(name, args).isError, true);
});

test("coding index provenance and validation coverage excludes private material", () => {
  assert.equal(codingBundle.operations.length, 28);
  assert.equal(codingBundle.examples.length, 116);
  for (const item of [...codingBundle.operations, ...codingBundle.examples]) {
    assert.equal(item.sourceSha256, codingBundle.sources[item.sourcePath]);
    assert.match(
      item.sourcePath,
      /^marketing\/(src\/content\/[a-z-]+\.(ts|json)|contracts\/openapi.json)$/,
    );
    assert.doesNotMatch(
      JSON.stringify(item),
      /\/app-api\/|first-party-current-|first-party-md-|docs\/internal\/|src\/ui\/catalyst/,
    );
  }
  for (const e of codingBundle.examples) {
    assert.equal(
      createHash("sha256").update(e.code).digest("hex"),
      e.codeSha256,
    );
    for (const id of e.operationIds)
      assert.ok(
        codingBundle.operations.some((o) => o.id === id),
        id,
      );
  }
});
