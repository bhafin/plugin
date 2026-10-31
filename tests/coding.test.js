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
  assert.equal(codingBundle.operations.length, 32);
  assert.equal(codingBundle.examples.length, 126);
  for (const item of [...codingBundle.operations, ...codingBundle.examples]) {
    assert.equal(item.sourceSha256, codingBundle.sources[item.sourcePath]);
    assert.match(
      item.sourcePath,
      /^(marketing\/src\/content\/[a-z-]+\.(ts|json)|sdk\/test\/((analytics\.|market-search\.)?openapi.json))$/,
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

test("analytics examples are discoverable by their exact operation IDs", () => {
  for (const [slug, id] of [
    ["scheme-performance", "analytics_scheme"],
    ["category-statistics", "analytics_category"],
  ]) {
    for (const section of ["request", "http"]) {
      const example = codingBundle.examples.find(
        (e) => e.id === `guide-${slug}-${section}`,
      );
      assert.ok(example.operationIds.includes(id));
      assert.equal(
        example.sourcePath,
        "marketing/src/content/analytics-guides.ts",
      );
    }
  }
});

test("observed filtered blank-query attempts receive actionable recovery without relaxing bounds", () => {
  for (const [name, args, corrected] of [
    [
      "bharosa_examples_search",
      { query: "", operationId: "retrieve_portfolio", language: "typescript" },
      {
        query: "retrieve_portfolio",
        operationId: "retrieve_portfolio",
        language: "typescript",
      },
    ],
    [
      "bharosa_api_search",
      { query: "", group: "monthly", limit: 20 },
      { query: "nav", group: "monthly", limit: 20 },
    ],
    [
      "bharosa_examples_search",
      { query: "", operationId: "list_portfolios", language: "typescript" },
      {
        query: "list_portfolios",
        operationId: "list_portfolios",
        language: "typescript",
      },
    ],
    [
      "bharosa_examples_search",
      { query: "", operationId: "search_funds", language: "typescript" },
      {
        query: "search_funds",
        operationId: "search_funds",
        language: "typescript",
      },
    ],
  ]) {
    const failed = execute(name, args);
    assert.equal(failed.isError, true);
    const error = JSON.parse(failed.content[0].text).error;
    assert.equal(error.code, "invalid_arguments");
    assert.match(error.message, /even with/);
    assert.match(error.message, /for example/);
    assert.ok(result(name, corrected).matches.length > 0);
    assert.equal(
      execute(name, { ...corrected, query: " ".repeat(121) + corrected.query })
        .isError,
      true,
    );
    assert.match(inputs[name].shape.query.description, /even when/);
  }
});

test("each search schema describes only its applicable filters", () => {
  const api = inputs.bharosa_api_search.shape.query.description;
  const examples = inputs.bharosa_examples_search.shape.query.description;
  assert.match(api, /group or method/);
  assert.doesNotMatch(api, /language|operationId/);
  assert.match(examples, /language or operationId/);
  assert.doesNotMatch(examples, /group|method/);
});

test("public market search and consent examples preserve exact scope and validation", () => {
  const search = result("bharosa_api_details", {
    operationId: "searchMarketSchemes",
  });
  assert.equal(search.operation.path, "/v1/market-data/schemes/search");
  assert.equal(search.operation.method, "GET");
  assert.equal(
    search.operation.sourcePath,
    "sdk/test/market-search.openapi.json",
  );
  assert.match(search.operation.definition.description, /Any active API key/);
  assert.ok(
    search.exampleIds.includes("guide-fund-autocomplete-baseline-search"),
  );
  const e = result("bharosa_examples_read", {
    id: "guide-fund-autocomplete-baseline-search",
  });
  assert.match(e.code, /bharosa.markets.schemes.search/);
  const consent = codingBundle.examples.filter(
    (x) => x.sourcePath === "marketing/src/content/consent-guide.ts",
  );
  assert.equal(consent.length, 3);
  for (const e of consent)
    assert.ok(["javascript-syntax-only", "json-parse"].includes(e.validation));
});
