import test from "node:test";
import assert from "node:assert/strict";
import { bundle, execute } from "../src/catalog.js";
const byId = (id) => bundle.docs.find((doc) => doc.id === id);
const json = (doc) =>
  JSON.parse(doc.content.split("```json\n")[1].split("\n```")[0]);
test("expanded corpus is pinned to approved public checkpoint and excludes private sources", () => {
  assert.equal(
    bundle.approvedManifestSha256,
    "d8a99bf46e2c709f72ea65b55c23aae1fd57f9208306553fa0ab9174af949721",
  );
  assert.equal(
    bundle.publicContractSha256,
    "3b791799bf705fd36a257e27a2520257f135e772d617b03bb22063ccea4d04e2",
  );
  assert.equal(bundle.docs.length, 102);
  assert.equal(bundle.docs.filter((d) => d.kind === "guide").length, 29);
  assert.match(bundle.notice, /not a live website fetch/);
  for (const doc of bundle.docs) {
    assert.ok(
      [
        "marketing/src/content/guides.ts",
        "sdk/test/openapi.json",
        "sdk/test/analytics.openapi.json",
        "marketing/src/content/analytics-guides.ts",
      ].includes(doc.sourcePath),
    );
    assert.ok(doc.content.length <= 30000);
    assert.doesNotMatch(
      doc.content,
      /\/app-api\/|first-party-md-|first-party-current-|"md_current_|"md_navs"|For Bharosa apps|docs\/internal\/|src\/ui\/catalyst/,
    );
    if (doc.kind === "reference") {
      if (doc.sourcePath === "sdk/test/openapi.json")
        assert.equal(doc.sourceSha256, bundle.publicContractSha256);
      assert.ok(doc.sourcePointer.startsWith("#/"));
    }
  }
});
test("four-decimal units, null valuation and unreleased guidance remain discoverable", () => {
  const units = json(byId("schema-unit-input"));
  const pattern = new RegExp(units.pattern);
  assert.ok(pattern.test("12.1234"));
  assert.equal(pattern.test("12.12340"), false);

  assert.match(byId("first-portfolio").content, /four fractional digits/);
  assert.match(byId("first-portfolio").content, /total_current_value.*null/);
  assert.ok(
    execute("bharosa_docs_search", {
      query: "four fractional digits",
      limit: 20,
    }).structuredContent.matches.some((d) => d.id === "first-portfolio"),
  );
  for (const id of [
    "authentication",
    "oauth",
    "errors",
    "idempotency",
    "pagination",
    "reference-create-portfolio",
    "schema-error",
  ])
    assert.ok(byId(id), id);
});
test("public reference pointers cover every resource operation and resolve schema references", () => {
  const operations = bundle.docs.filter((d) =>
    d.sourcePointer?.startsWith("#/paths/"),
  );
  assert.equal(operations.length, 26);
  const pointers = new Set(bundle.docs.map((d) => d.sourcePointer));
  function walk(value) {
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (key === "$ref") assert.ok(pointers.has(item), item);
      else walk(item);
    }
  }
  for (const doc of bundle.docs.filter((d) => d.kind === "reference"))
    walk(json(doc));
  for (const doc of operations)
    assert.match(json(doc).path, /^\/v1\/accounts\//);
});

test("v24 public guidance matches published SDK and current scope", () => {
  assert.match(byId("integrations").content, /bharosa@0\.4\.0/);
  assert.match(
    byId("documentation-assistant").content,
    /https:\/\/mcp.bharosa.finance\//,
  );
  assert.match(
    byId("documentation-assistant").content,
    /Public directory listings are pending/,
  );
  assert.match(byId("documentation-assistant").content, /integration.*skill/);
  assert.match(byId("oauth").content, /setup_required/);
  assert.match(byId("oauth").content, /does not mean the app is ready/);
  assert.match(byId("pagination").content, /InvalidResponseError/);
  assert.match(byId("pagination").content, /stop on overlap or cycles/);
  assert.match(byId("errors").content, /original body and idempotency key/);
  assert.match(byId("scheme-performance").content, /not an investor/);
  assert.match(byId("category-statistics").content, /80% coverage/);
  for (const id of ["scheme-performance", "category-statistics"])
    assert.equal(
      byId(id).sourcePath,
      "marketing/src/content/analytics-guides.ts",
    );
});

test("autocomplete guidance preserves unreleased limits and draft-safe retry", () => {
  const text = byId("fund-autocomplete").content;

  assert.match(text, /commas, parentheses and slashes/);
  assert.match(text, /not typo correction or abbreviation expansion/);
  assert.match(text, /Keep the entered draft and any saved holdings/);
  assert.match(text, /Retry fund search/);
  assert.match(text, /explicit catalogue plan and optional option/);
  assert.match(text, /Regular Growth or Direct Growth/);
  assert.match(text, /Omitting an option does not choose Growth/);
  assert.match(text, /omitting a plan does not default to Direct/);
  assert.match(text, /Keep meaningful words such as Growth in the fund name/);
  assert.match(text, /not evidence that a portfolio save occurred/);
  assert.match(text, /do not automatically select the first match/);
});
