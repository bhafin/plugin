import test from "node:test";
import assert from "node:assert/strict";
import { bundle, execute } from "../src/catalog.js";
const byId = (id) => bundle.docs.find((doc) => doc.id === id);
const json = (doc) =>
  JSON.parse(doc.content.split("```json\n")[1].split("\n```")[0]);
test("expanded corpus is pinned to approved public checkpoint and excludes private sources", () => {
  assert.equal(
    bundle.approvedManifestSha256,
    "4c223925f048e40ca1762c781848c677055db447870031328fee017ceb5ee1ac",
  );
  assert.equal(
    bundle.publicContractSha256,
    "5ae700e29c7f54df12d5634f36cad08785240ee5b019d5921bf0792f53b7866c",
  );
  assert.equal(bundle.docs.length, 96);
  assert.equal(bundle.docs.filter((d) => d.kind === "guide").length, 27);
  assert.match(bundle.notice, /not a live website fetch/);
  for (const doc of bundle.docs) {
    assert.ok(
      [
        "marketing/src/content/guides.ts",
        "marketing/contracts/openapi.json",
      ].includes(doc.sourcePath),
    );
    assert.ok(doc.content.length <= 30000);
    assert.doesNotMatch(
      doc.content,
      /\/app-api\/|first-party-md-|first-party-current-|"md_current_|"md_navs"|For Bharosa apps|docs\/internal\/|src\/ui\/catalyst/,
    );
    if (doc.kind === "reference") {
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
  assert.match(byId("first-portfolio").content, /not released yet/);
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
  assert.equal(operations.length, 23);
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

test("reconciled setup guides preserve local scope and name the predecessor checksum", () => {
  const assistant = byId("documentation-assistant").content;
  assert.match(assistant, /Node.js 22\.12 or later/);
  assert.match(assistant, /desktopHostVerified: false/);
  assert.match(assistant, /rehearsal\.6 archive/);
  assert.match(
    assistant,
    /064e86a5aa7357a5be172607ff2f9e7c853630c97acfad83bd7cb5acb5ba6c75/,
  );
  assert.match(assistant, /documentation is a frozen snapshot/);
  assert.match(
    assistant,
    /local rehearsal packages, not a published marketplace listing/,
  );
  assert.match(assistant, /Claude Code installation was verified/);
  assert.match(assistant, /source is now public under MIT/);
  assert.match(byId("event-rehearsal").content, /fictional/);
  assert.match(byId("event-rehearsal").content, /authorized account/);
});

test("October 27 source separates local consent implementation from hosted access", () => {
  assert.match(
    byId("app-quickstart").content,
    /not enabled on the hosted service/,
  );
  assert.match(byId("app-quickstart").content, /simulated identity provider/);
  assert.match(
    byId("documentation-assistant").content,
    /cannot retrieve accounts/,
  );
  assert.match(byId("integrations").content, /0\.1\.0/);
});

test("final recovery and offline/module guidance preserves local safety boundaries", () => {
  assert.match(byId("pagination").content, /InvalidResponseError/);
  assert.match(byId("pagination").content, /stop on overlap or cycles/);
  assert.match(
    byId("errors").content,
    /after commit starts, the result can be uncertain/,
  );
  assert.match(byId("errors").content, /original body and idempotency key/);
  assert.match(
    byId("integrations").content,
    /Installed SDK synthetic smoke passed/,
  );
  assert.match(byId("integrations").content, /No network or persisted writes/);
  assert.match(
    byId("integrations").content,
    /module compatibility, not permission to put account keys in browser code/,
  );
});

test("autocomplete guidance preserves unreleased limits and draft-safe retry", () => {
  const text = byId("fund-autocomplete").content;
  assert.match(text, /local, unreleased search/);
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
