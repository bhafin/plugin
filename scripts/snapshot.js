// Maintainer-only exact public allowlist. Literal core guide parsing plus a pinned
// public analytics prose module; no source is executed by the running server.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
const root = process.env.BHAROSA_MARKETING_ROOT
  ? pathToFileURL(resolve(process.env.BHAROSA_MARKETING_ROOT) + sep)
  : new URL("../../marketing/", import.meta.url);
const policy = JSON.parse(
  readFileSync(new URL("./source-checkpoint.json", import.meta.url), "utf8"),
);
const hash = (s) => createHash("sha256").update(s).digest("hex");
const publicPaths = [
  "src/content/guides.ts",
  "src/content/product.ts",
  "contracts/openapi.json",
  "src/content/analytics-guides.ts",
  "contracts/analytics.openapi.json",
  "reviewed-guides.json",
  "src/content/consent-guide.ts",
  "contracts/market-search.openapi.json",
];
const texts = Object.fromEntries(
  publicPaths.map((path) => {
    const text = readFileSync(new URL(path, root), "utf8");
    if (hash(text) !== policy.sources[path])
      throw new Error(`Unapproved source drift: ${path}`);
    return [path, text];
  }),
);
const source = texts[publicPaths[0]],
  product = texts[publicPaths[1]],
  contract = JSON.parse(texts[publicPaths[2]]);
const contractVersion = product.match(
  /export const contractVersion = "([^"]+)";/,
)?.[1];
const reviewedOn = product.match(/export const reviewedOn = "([^"]+)";/)?.[1];
if (!contractVersion || !reviewedOn)
  throw new Error("Missing canonical contract references; prototype unready");

// Parse only literal prose arrays. Reject expressions/unknown escape forms instead
// of executing TS or silently dropping paragraphs. Code/example arguments omitted.
function proseReader(text, start) {
  let i = start;
  const ws = () => {
    while (/\s/.test(text[i] ?? "") && i < text.length) i++;
  };
  const take = (token) => {
    ws();
    if (text[i] !== token) throw Error(`Expected ${token} at ${i}`);
    i++;
  };
  const string = () => {
    ws();
    const quote = text[i++];
    if (quote !== "'" && quote !== '"')
      throw Error("Expected literal prose string");
    let value = "";
    while (i < text.length) {
      let char = text[i++];
      if (char === quote) return value;
      if (char === "\\") {
        char = text[i++];
        const escapes = {
          n: "\n",
          r: "\r",
          t: "\t",
          b: "\b",
          f: "\f",
          v: "\v",
          "'": "'",
          '"': '"',
          "\\": "\\",
        };
        if (Object.hasOwn(escapes, char)) value += escapes[char];
        else if (char === "u" || char === "x") {
          const count = char === "u" ? 4 : 2;
          const digits = text.slice(i, i + count);
          if (!new RegExp(`^[a-fA-F0-9]{${count}}$`).test(digits))
            throw Error("Invalid escape");
          value += String.fromCharCode(parseInt(digits, 16));
          i += count;
        } else throw Error("Unsupported prose escape");
      } else {
        if (char === "\n" || char === "\r")
          throw Error("Multiline literal unsupported");
        value += char;
      }
    }
    throw Error("Unterminated prose string");
  };
  return {
    take,
    string,
    array: () => {
      const values = [];
      take("[");
      ws();
      while (text[i] !== "]") {
        values.push(string());
        ws();
        if (text[i] !== ",") break;
        i++;
        ws();
      }
      take("]");
      return values;
    },
  };
}
// Evaluated public guides are separately hash-pinned by the signed website owner.
// Preserve computed prose exactly rather than silently dropping expressions.
const reviewedGuides = JSON.parse(texts["reviewed-guides.json"]);
const docs = reviewedGuides.map((guide) => {
  const analytics = texts["src/content/analytics-guides.ts"];
  const sourcePath =
    guide.slug === "connect-an-account"
      ? "src/content/consent-guide.ts"
      : analytics.includes(`slug: "${guide.slug}"`)
        ? "src/content/analytics-guides.ts"
        : "src/content/guides.ts";
  const sourceText = texts[sourcePath];
  if (!/^[a-z-]+$/.test(guide.slug) || !guide.sections.length)
    throw Error("Invalid reviewed guide");
  return {
    id: guide.slug,
    title: guide.title,
    kind: "guide",
    sourcePath: `marketing/${sourcePath}`,
    sourceLine: sourceText
      .slice(0, Math.max(0, sourceText.indexOf(`slug: "${guide.slug}"`)))
      .split("\n").length,
    sourcePointer: guide.slug,
    sourceRoute: `/docs/${guide.slug}`,
    sourceSha256: hash(sourceText),
    content: `# ${guide.title}\n\n${guide.sections.map((section) => `## ${section.title}\n\n${section.paragraphs.join("\n\n")}`).join("\n\n")}`,
  };
});
const referenceDoc = (id, title, pointer, value) => ({
  id,
  title,
  kind: "reference",
  sourcePath: "sdk/test/openapi.json",
  sourceLine: 1,
  sourcePointer: pointer,
  sourceRoute: "/docs/reference",
  sourceSha256: hash(texts[publicPaths[2]]),
  content: `# ${title}\n\nVersioned public contract snapshot; not proof of hosted API availability.\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``,
});
const pointer = (key) => key.replaceAll("~", "~0").replaceAll("/", "~1");
for (const [path, methods] of Object.entries(contract.paths)) {
  if (!path.startsWith("/v1/accounts/"))
    throw Error("Unexpected public route scope");
  for (const [method, operation] of Object.entries(methods)) {
    if (!["get", "post", "patch", "put", "delete"].includes(method))
      throw Error("Unexpected operation shape");
    docs.push(
      referenceDoc(
        `reference-${operation.operationId.replaceAll("_", "-")}`,
        operation.summary,
        `#/paths/${pointer(path)}/${method}`,
        { method: method.toUpperCase(), path, ...operation },
      ),
    );
  }
}
const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
for (const [name, schema] of Object.entries(contract.components.schemas))
  docs.push(
    referenceDoc(
      `schema-${kebab(name)}`,
      `${name} schema`,
      `#/components/schemas/${pointer(name)}`,
      schema,
    ),
  );
docs.push(
  referenceDoc(
    "reference-authentication",
    "Resource API authentication schemes",
    "#/components/securitySchemes",
    contract.components.securitySchemes,
  ),
);
const analyticsContract = JSON.parse(texts["contracts/analytics.openapi.json"]);
for (const [path, methods] of Object.entries(analyticsContract.paths)) {
  for (const [method, operation] of Object.entries(methods)) {
    const doc = referenceDoc(
      `reference-${operation.operationId.replaceAll("_", "-")}`,
      operation.summary,
      `#/paths/${pointer(path)}/${method}`,
      { method: method.toUpperCase(), path, ...operation },
    );
    doc.sourcePath = "sdk/test/analytics.openapi.json";
    doc.sourceSha256 = hash(texts["contracts/analytics.openapi.json"]);
    docs.push(doc);
  }
}
const marketSearchContract = JSON.parse(
  texts["contracts/market-search.openapi.json"],
);
for (const [name, schema] of Object.entries(
  marketSearchContract.components.schemas,
)) {
  if (
    JSON.stringify(schema) !== JSON.stringify(contract.components.schemas[name])
  )
    throw Error(
      `Market search schema differs from shared public schema: ${name}`,
    );
}
for (const [path, methods] of Object.entries(marketSearchContract.paths)) {
  if (path !== "/v1/market-data/schemes/search")
    throw Error("Unexpected market search route");
  for (const [method, operation] of Object.entries(methods)) {
    if (method !== "get") throw Error("Unexpected market search method");
    const doc = referenceDoc(
      `reference-${kebab(operation.operationId).replaceAll("_", "-")}`,
      operation.summary,
      `#/paths/${pointer(path)}/${method}`,
      { method: method.toUpperCase(), path, ...operation },
    );
    doc.sourcePath = "sdk/test/market-search.openapi.json";
    doc.sourceSha256 = hash(texts["contracts/market-search.openapi.json"]);
    doc.sourceRoute = "/docs/monthly-market-data";
    docs.push(doc);
  }
}
const forbidden = [
  /\/app-api\//,
  /first-party-md-/,
  /first-party-current-/,
  /"md_current_/,
  /"md_navs"/,
  /For Bharosa apps/,
  /docs\/internal\//,
  /src\/ui\/catalyst/,
];
for (const doc of docs) {
  if (doc.content.length > 30000)
    throw Error(`Document exceeds bound: ${doc.id}`);
  if (forbidden.some((pattern) => pattern.test(doc.content)))
    throw Error(`Private marker in ${doc.id}`);
}
const bundle = {
  bundleVersion: "0.3.2-docs.1",
  contractVersion,
  contractSourcePath: "marketing/src/content/product.ts",
  contractSourceSha256: hash(product),
  publicContractSha256: hash(texts[publicPaths[2]]),
  publicContractVersion: contract.info.version,
  approvedManifestSha256: policy.approvedManifestSha256,
  checkpointDate: policy.checkpointDate,
  reviewedOn,
  availability: "bundled-snapshot",
  notice:
    "Versioned public-documentation snapshot, not a live website fetch or proof of deployed API availability. API routes are reference text only; this MCP server has no account access. Guide prose and API schemas are supplemented by separately indexed canonical examples.",
  docs,
};
const target = new URL("../assets/docs.json", import.meta.url);
const output = JSON.stringify(bundle, null, 2) + "\n";
if (process.argv.includes("--check")) {
  if (readFileSync(target, "utf8") !== output)
    throw Error("Bundle differs from approved public checkpoint");
} else writeFileSync(target, output);
const runtimePath = new URL("../src/catalog.js", import.meta.url);
const runtime = readFileSync(runtimePath, "utf8");
const pinned = runtime.replace(
  /(export const snapshotSha256 =\s*)"[a-f0-9]{64}"/,
  `$1"${hash(output)}"`,
);
if (process.argv.includes("--check")) {
  if (runtime !== pinned)
    throw Error("Runtime documentation integrity pin differs");
} else writeFileSync(runtimePath, pinned);
console.log(
  `Verified ${docs.length} public documentation entries against approved checkpoint.`,
);
