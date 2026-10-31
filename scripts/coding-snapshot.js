// Maintainer-only generator: evaluate only the reviewed public content-module graph.
// Nothing from this source checkout is read or executed by the running MCP server.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const marketing = process.env.BHAROSA_MARKETING_ROOT
  ? resolve(process.env.BHAROSA_MARKETING_ROOT)
  : resolve(root, "../marketing");
const hash = (data) => createHash("sha256").update(data).digest("hex");
const policy = JSON.parse(
  readFileSync(join(root, "scripts/coding-source-checkpoint.json")),
);
const docs = JSON.parse(readFileSync(join(root, "assets/docs.json")));
const sdkVersion = JSON.parse(readFileSync(join(root, "package.json")))
  .devDependencies.bharosa;
assert.match(
  sdkVersion,
  /^\d+\.\d+\.\d+$/,
  "SDK validation version must be exactly pinned",
);
assert.equal(policy.canonicalCheckpointSha256, docs.approvedManifestSha256);
const stage = mkdtempSync(join(tmpdir(), "bharosa-public-content-"));
const examples = [],
  operations = [];
const sources = {};
try {
  writeFileSync(join(stage, "package.json"), '{"type":"module"}');
  for (const [source, expected] of Object.entries(policy.sources)) {
    assert.match(source, /^src\/content\/[a-z-]+\.(ts|json)$/);
    const text = readFileSync(join(marketing, source), "utf8");
    assert.equal(hash(text), expected, `Unreviewed example source: ${source}`);
    sources[`marketing/${source}`] = expected;
    // Canonical modules use extensionless local TypeScript imports. Resolve only
    // within the pinned graph, including type-only dependencies.
    const normalized = text.replace(
      /from "(\.\/[^"\n]+)"/g,
      (match, specifier) => {
        const target = /\.(ts|json)$/.test(specifier)
          ? specifier
          : `${specifier}.ts`;
        assert.ok(
          Object.hasOwn(policy.sources, `src/content/${target.slice(2)}`),
          target,
        );
        return `from "${target}"`;
      },
    );
    const target = join(stage, source);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, normalized);
  }
  const product = await import(
    pathToFileURL(join(stage, "src/content/product.ts"))
  );
  const { requestExamples } = await import(
    pathToFileURL(join(stage, "src/content/examples.ts"))
  );
  const { analyticsGuides } = await import(
    pathToFileURL(join(stage, "src/content/analytics-guides.ts"))
  );
  const analyticsSlugs = new Set(analyticsGuides.map((guide) => guide.slug));
  const { guides } = await import(
    pathToFileURL(join(stage, "src/content/guides.ts"))
  );
  const { monthlyPages, monthlyOperations } = await import(
    pathToFileURL(join(stage, "src/content/monthly.ts"))
  );
  const contractBytes = readFileSync(join(marketing, "contracts/openapi.json"));
  assert.equal(hash(contractBytes), docs.publicContractSha256);
  const contract = JSON.parse(contractBytes);
  sources["sdk/test/openapi.json"] = docs.publicContractSha256;
  const summary = (id, title, sourcePath, sourcePointer, route) => ({
    id,
    title,
    sourcePath,
    sourcePointer,
    sourceRoute: route,
    sourceSha256: sources[sourcePath],
  });
  function example(
    id,
    title,
    language,
    code,
    sourcePath,
    sourcePointer,
    route,
    operationIds = [],
    setup = "",
  ) {
    assert.ok(code.length && code.length <= 30000 && setup.length <= 8000);
    examples.push({
      ...summary(id, title, sourcePath, sourcePointer, route),
      language,
      code,
      setup,
      codeSha256: hash(code),
      operationIds,
      sdkVersion,
      validation:
        language === "typescript"
          ? id.startsWith("sdk-")
            ? "strict-typescript-and-synthetic-transport"
            : "strict-typescript"
          : language === "bash"
            ? "shell-syntax-only"
            : "json-parse",
      notice:
        "Example text only. Never executed by this tool. Placeholders are synthetic; live account actions require separate authorization.",
    });
  }
  const slugToOperation = new Map();
  for (const [path, methods] of Object.entries(contract.paths))
    for (const [method, op] of Object.entries(methods)) {
      const e = product.endpoints.find(
        (e) => e.path === path && e.method.toLowerCase() === method,
      );
      assert.ok(!e || e.availability !== "first-party", `${method} ${path}`);
      if (e) slugToOperation.set(e.slug, op.operationId);
      const pointer = `#/paths/${path.replaceAll("~", "~0").replaceAll("/", "~1")}/${method}`;
      operations.push({
        ...summary(
          op.operationId,
          op.summary,
          "sdk/test/openapi.json",
          pointer,
          e ? `/docs/${e.slug}` : "/docs/reference",
        ),
        method: method.toUpperCase(),
        path,
        group: "resource",
        definition: op,
        sampleResponse: e?.response,
        sampleStatus: e?.status,
      });
      if (!e) continue; // Reference is exact; no canonical example is available.
      for (const delegated of [false, true]) {
        const code = requestExamples(e, delegated),
          auth = delegated ? "delegated" : "account";
        for (const [language, key, prefix] of [
          ["typescript", "sdk", "sdk"],
          ["bash", "curl", "curl"],
        ])
          example(
            `${prefix}-${auth}-${e.slug}`,
            `${e.title ?? e.slug}: ${auth} ${language}`,
            language,
            code[key],
            "marketing/src/content/examples.ts",
            `requestExamples(${e.slug},${delegated})`,
            `/docs/${e.slug}`,
            [op.operationId],
          );
      }
    }
  const analyticsBytes = readFileSync(
    join(marketing, "contracts/analytics.openapi.json"),
  );
  assert.equal(
    hash(analyticsBytes),
    policy.contracts["contracts/analytics.openapi.json"],
  );
  sources["sdk/test/analytics.openapi.json"] = hash(analyticsBytes);
  for (const [path, methods] of Object.entries(
    JSON.parse(analyticsBytes).paths,
  )) {
    for (const [method, op] of Object.entries(methods)) {
      const slug = path.endsWith("/performance")
        ? "scheme-performance"
        : "category-statistics";
      slugToOperation.set(slug, op.operationId);
      operations.push({
        ...summary(
          op.operationId,
          op.summary,
          "sdk/test/analytics.openapi.json",
          `#/paths/${path.replaceAll("~", "~0").replaceAll("/", "~1")}/${method}`,
          `/docs/${slug}`,
        ),
        method: method.toUpperCase(),
        path,
        group: "monthly",
        definition: op,
      });
    }
  }
  const allowedGuides = new Set(
    docs.docs.filter((d) => d.kind === "guide").map((d) => d.id),
  );
  for (const guide of guides.filter((g) => allowedGuides.has(g.slug)))
    for (const section of guide.sections) {
      if (!section.code) continue;
      const code = section.code,
        start = code.trimStart();
      let language = /^(?:#|(?:curl|npm|node|codex|claude)\b)/.test(start)
        ? "bash"
        : "typescript";
      if (start.startsWith("{")) {
        JSON.parse(code);
        language = "json";
      }
      const operationIds = [
        ...new Set([
          ...(section.links ?? []),
          ...(analyticsSlugs.has(guide.slug) ? [guide.slug] : []),
        ]),
      ]
        .map((slug) => slugToOperation.get(slug))
        .filter(Boolean);
      example(
        `guide-${guide.slug}-${section.id}`,
        `${guide.title}: ${section.title}`,
        language,
        code,
        analyticsSlugs.has(guide.slug)
          ? "marketing/src/content/analytics-guides.ts"
          : "marketing/src/content/guides.ts",
        `${guide.slug}#${section.id}`,
        `/docs/${guide.slug}#${section.id}`,
        operationIds,
        language === "typescript" && !code.includes("import { Bharosa }")
          ? product.sdkInitialization
          : "",
      );
    }
  for (const page of monthlyPages) {
    const op = monthlyOperations[page.id];
    assert.ok(op && op.path.startsWith("/v1/accounts/"));
    operations.push({
      ...summary(
        op.operationId,
        page.title,
        "marketing/src/content/monthly-schema.json",
        `#/${page.id}`,
        `/docs/${page.slug}`,
      ),
      method: op.method,
      path: op.path,
      group: "monthly",
      definition: op,
    });
    example(
      `monthly-${page.slug}`,
      page.title,
      "typescript",
      page.code,
      "marketing/src/content/monthly.ts",
      page.id,
      `/docs/${page.slug}`,
      [page.id],
      product.sdkInitialization,
    );
  }
} finally {
  rmSync(stage, { recursive: true, force: true });
}
for (const value of [...examples, ...operations]) {
  const text = JSON.stringify(value);
  assert.ok(text.length <= 60000);
  assert.doesNotMatch(
    text,
    /\/app-api\/|first-party-current-|first-party-md-|docs\/internal\/|src\/ui\/catalyst/,
  );
}
assert.equal(new Set(examples.map((e) => e.id)).size, examples.length);
assert.equal(new Set(operations.map((e) => e.id)).size, operations.length);
const value = {
  version: "0.3.1-coding.1",
  docsSnapshotSha256: hash(readFileSync(join(root, "assets/docs.json"))),
  approvedManifestSha256: docs.approvedManifestSha256,
  sources,
  sdkVersion,
  operations,
  examples,
};
const text = JSON.stringify(value, null, 2) + "\n",
  target = join(root, "assets/coding.json");
if (process.argv.includes("--check"))
  assert.equal(readFileSync(target, "utf8"), text);
else writeFileSync(target, text);
const runtimePath = join(root, "src/coding-catalog.js");
const runtime = readFileSync(runtimePath, "utf8");
const pinned = runtime.replace(
  /(export const codingSha256 =\s*)"[a-f0-9]{64}"/,
  `$1"${hash(text)}"`,
);
if (process.argv.includes("--check"))
  assert.equal(runtime, pinned, "Runtime coding integrity pin differs");
else writeFileSync(runtimePath, pinned);
console.log(
  JSON.stringify({
    operations: operations.length,
    examples: examples.length,
    sha256: hash(text),
  }),
);
