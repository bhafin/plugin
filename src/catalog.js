import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { z } from "zod";
import { createCodingTools } from "./coding-catalog.js";

const document = z
  .object({
    id: z.string().regex(/^[a-z-]+$/),
    title: z.string(),
    sourcePath: z.enum([
      "marketing/src/content/guides.ts",
      "marketing/src/content/analytics-guides.ts",
      "sdk/test/openapi.json",
      "sdk/test/analytics.openapi.json",
      "sdk/test/market-search.openapi.json",
      "marketing/src/content/consent-guide.ts",
    ]),
    sourceLine: z.number().int().positive(),
    sourcePointer: z.string().nullable(),
    kind: z.enum(["guide", "reference"]),
    sourceRoute: z.string(),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    content: z.string().max(30000),
  })
  .strict();
const bundleSchema = z
  .object({
    bundleVersion: z.literal("0.3.2-docs.1"),
    contractVersion: z.literal("API v1"),
    contractSourcePath: z.literal("marketing/src/content/product.ts"),
    contractSourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    publicContractSha256: z.string().regex(/^[a-f0-9]{64}$/),
    publicContractVersion: z.string(),
    approvedManifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
    checkpointDate: z.string(),
    reviewedOn: z.string(),
    availability: z.literal("bundled-snapshot"),
    notice: z.string(),
    docs: z.array(document).min(1).max(128),
  })
  .strict();
export const snapshotSha256 =
  "31c0e3ddf3ba1ba27731b6b94f7e3612f2b81a46ce8a49e25cb8b159bc61db41";
const bundledText = readFileSync(
  new URL("../assets/docs.json", import.meta.url),
  "utf8",
);
if (createHash("sha256").update(bundledText).digest("hex") !== snapshotSha256)
  throw new Error(
    "Bundled documentation integrity check failed. Reinstall the reviewed local package.",
  );
export const bundle = bundleSchema.parse(JSON.parse(bundledText));
if (new Set(bundle.docs.map((d) => d.id)).size !== bundle.docs.length)
  throw new Error("Duplicate document ID");
const { docs, ...metadata } = bundle;
const metadataShape = bundleSchema.omit({ docs: true }).shape;
const coding = createCodingTools(
  metadataShape,
  snapshotSha256,
  metadata.approvedManifestSha256,
);
export const inputs = {
  ...coding.inputs,
  bharosa_docs_list: z
    .object({
      offset: z.number().int().min(0).max(128).default(0),
      limit: z.number().int().min(1).max(20).default(10),
    })
    .strict(),
  bharosa_docs_search: z
    .object({
      query: z.string().max(120).trim().min(1),
      limit: z.number().int().min(1).max(20).default(5),
    })
    .strict(),
  bharosa_docs_read: z
    .object({
      id: z.string().regex(/^[a-z-]{1,64}$/),
      offset: z.number().int().min(0).max(30000).default(0),
      maxChars: z.number().int().min(1).max(8000).default(4000),
    })
    .strict(),
};
const summarySchema = document
  .omit({ content: true })
  .extend({ totalChars: z.number().int().nonnegative() });
const nextOffset = z.number().int().nonnegative().nullable();
export const outputs = {
  ...coding.outputs,
  bharosa_docs_list: z
    .object({
      ...metadataShape,
      documents: z.array(summarySchema).max(20),
      total: z.number().int(),
      nextOffset,
    })
    .strict(),
  bharosa_docs_search: z
    .object({
      ...metadataShape,
      matches: z
        .array(summarySchema.extend({ snippet: z.string().max(300) }))
        .max(20),
      total: z.number().int(),
    })
    .strict(),
  bharosa_docs_read: z
    .object({
      ...metadataShape,
      document: summarySchema,
      content: z.string().max(8000),
      offset: z.number().int(),
      nextOffset,
    })
    .strict(),
};
const summary = ({ content, ...rest }) => ({
  ...rest,
  totalChars: content.length,
});
export function execute(name, raw) {
  if (!Object.hasOwn(inputs, name))
    return failure(
      "unknown_tool",
      "Use the advertised bharosa_ documentation, API-reference and example tools; no account or filesystem tools are available.",
    );
  // Inspect the original object before Zod can normalize special keys.
  if (
    raw === null ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    Reflect.ownKeys(raw).some(
      (key) =>
        typeof key !== "string" || !Object.hasOwn(inputs[name].shape, key),
    )
  )
    return failure(
      "invalid_arguments",
      "Pass a JSON object containing only the fields shown by tools/list; remove unknown fields.",
    );
  const parsed = inputs[name].safeParse(raw);
  if (!parsed.success)
    return failure(
      "invalid_arguments",
      {
        bharosa_docs_list:
          "Use integer offset 0–128 and limit 1–20; omit both for the first page.",
        bharosa_docs_search:
          "Use a nonblank query of at most 120 raw characters and integer limit 1–20. Whitespace counts toward the raw bound.",
        bharosa_api_search:
          'Supply a nonblank query even with group or method filters, for example {"query":"nav","group":"monthly"}. Query is at most 120 raw characters; limit is an integer 1–20.',
        bharosa_examples_search:
          'Supply a nonblank query even with operationId or language filters. To find an operation example, use its ID as query, for example {"query":"retrieve_portfolio","operationId":"retrieve_portfolio","language":"typescript"}. Query is at most 120 raw characters; limit is an integer 1–20.',
        bharosa_docs_read:
          "Choose an ID from bharosa_docs_list; use integer offset 0–30000 and maxChars 1–8000.",
      }[name] ??
        "Use only the advertised fields and bounds. Search queries must be nonblank and at most 120 raw characters.",
    );
  const args = parsed.data;
  let data;
  if (Object.hasOwn(coding.inputs, name)) {
    data = coding.execute(name, args);
    if (data.error) return failure(data.error.code, data.error.message);
  } else if (name === "bharosa_docs_list") {
    if (args.offset > docs.length)
      return failure(
        "invalid_offset",
        `Use an offset from 0 through ${docs.length}, or follow the previous page’s nextOffset.`,
      );
    const end = args.offset + args.limit;
    data = {
      documents: docs.slice(args.offset, end).map(summary),
      total: docs.length,
      nextOffset: end < docs.length ? end : null,
    };
  } else if (name === "bharosa_docs_search") {
    const query = args.query.toLowerCase().replace(/\s+/gu, " ");
    const terms = [...new Set(query.split(" "))];
    const matches = docs
      .map((doc, index) => {
        const title = doc.title.toLowerCase(),
          id = doc.id.toLowerCase(),
          body = doc.content.toLowerCase();
        const searchable = `${id}\n${title}\n${body}`;
        if (!terms.every((term) => searchable.includes(term))) return null;
        // Exact IDs/titles, then title matches. Stable source order breaks ties.
        const score =
          (id === query ? 1000 : 0) +
          (title === query ? 900 : 0) +
          (title.includes(query) ? 200 : 0) +
          (terms.every((term) => title.includes(term)) ? 100 : 0) +
          terms.filter((term) => title.includes(term)).length * 10;
        return { doc, index, score };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score || a.index - b.index);
    data = {
      matches: matches.slice(0, args.limit).map(({ doc }) => {
        const lower = doc.content.toLowerCase();
        const positions = terms
          .map((term) => lower.indexOf(term))
          .filter((position) => position >= 0);
        const position = Math.max(
          0,
          (positions.length ? Math.min(...positions) : 0) - 60,
        );
        return {
          ...summary(doc),
          snippet: doc.content.slice(position, position + 300),
        };
      }),
      total: matches.length,
    };
  } else {
    const doc = docs.find((d) => d.id === args.id);
    if (!doc)
      return failure(
        "document_not_found",
        "Use bharosa_docs_list to select a bundled document ID.",
      );
    if (args.offset > doc.content.length)
      return failure(
        "invalid_offset",
        `Use an offset from 0 through ${doc.content.length}, or follow the previous chunk’s nextOffset.`,
      );
    const end = args.offset + args.maxChars;
    data = {
      document: summary(doc),
      content: doc.content.slice(args.offset, end),
      offset: args.offset,
      nextOffset: end < doc.content.length ? end : null,
    };
  }
  const result = { ...metadata, ...data };
  if (!outputs[name].safeParse(result).success)
    return failure(
      "invalid_result",
      "Documentation result did not match its advertised schema.",
    );
  return {
    content: [{ type: "text", text: JSON.stringify(result) }],
    structuredContent: result,
  };
}
export function failure(code, message) {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({ ...metadata, error: { code, message } }),
      },
    ],
  };
}
