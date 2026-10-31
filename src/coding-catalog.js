import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { z } from "zod";

export const codingSha256 =
  "4498f89b109ef8702daa3e2807f5e686b187a05e6a6c5775e7029ab50d2d525c";
const bytes = readFileSync(new URL("../assets/coding.json", import.meta.url));
if (createHash("sha256").update(bytes).digest("hex") !== codingSha256)
  throw Error(
    "Coding reference integrity check failed. Reinstall the reviewed package.",
  );
const origin = {
  id: z.string().max(128),
  title: z.string().max(300),
  sourcePath: z.string().max(160),
  sourcePointer: z.string().max(300),
  sourceRoute: z.string().max(300),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
};
const operation = z
  .object({
    ...origin,
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    path: z.string().max(300),
    group: z.enum(["resource", "monthly"]),
    definition: z.record(z.string(), z.unknown()),
    sampleResponse: z.unknown().optional(),
    sampleStatus: z.number().int().optional(),
  })
  .strict();
const example = z
  .object({
    ...origin,
    language: z.enum(["typescript", "javascript", "bash", "json"]),
    code: z.string().max(30000),
    setup: z.string().max(8000),
    codeSha256: z.string(),
    operationIds: z.array(z.string()).max(30),
    sdkVersion: z.literal("0.6.0"),
    validation: z.enum([
      "strict-typescript-and-synthetic-transport",
      "strict-typescript",
      "shell-syntax-only",
      "javascript-syntax-only",
      "json-parse",
    ]),
    notice: z.string().max(500),
  })
  .strict();
export const codingBundle = z
  .object({
    version: z.literal("0.3.2-coding.1"),
    docsSnapshotSha256: z.string(),
    approvedManifestSha256: z.string(),
    sources: z.record(z.string(), z.string()),
    sdkVersion: z.literal("0.6.0"),
    operations: z.array(operation).max(100),
    examples: z.array(example).max(300),
  })
  .strict()
  .parse(JSON.parse(bytes));
for (const op of codingBundle.operations)
  if (JSON.stringify(op).length > 60000)
    throw Error("Operation exceeds bounded reference size");
const query = z.string().max(120).trim().min(1);
const limit = z.number().int().min(1).max(20).default(5);
const opSummary = operation.omit({
  definition: true,
  sampleResponse: true,
  sampleStatus: true,
});
const exSummary = example
  .omit({ code: true, setup: true })
  .extend({ codeChars: z.number().int(), requiresSetup: z.boolean() });
const summarizeExample = ({ code, setup, ...rest }) => ({
  ...rest,
  codeChars: code.length,
  requiresSetup: Boolean(setup),
});
const summarizeOperation = ({
  definition,
  sampleResponse,
  sampleStatus,
  ...rest
}) => rest;
function search(items, text, searchText) {
  const terms = [...new Set(text.toLowerCase().split(/\s+/))];
  return items
    .map((item, index) => {
      const haystack = searchText(item).toLowerCase(),
        title = item.title.toLowerCase();
      if (!terms.every((term) => haystack.includes(term))) return null;
      return {
        item,
        index,
        score:
          (item.id.toLowerCase() === text.toLowerCase() ? 1000 : 0) +
          (title === text.toLowerCase() ? 900 : 0) +
          terms.filter((term) => title.includes(term)).length * 10,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((x) => x.item);
}
export function createCodingTools(metadataShape, docsDigest, checkpoint) {
  if (
    codingBundle.docsSnapshotSha256 !== docsDigest ||
    codingBundle.approvedManifestSha256 !== checkpoint
  )
    throw Error("Coding references and documentation checkpoints differ");
  const provenance = {
    codingVersion: codingBundle.version,
    codingSha256,
    sdkVersion: codingBundle.sdkVersion,
  };
  const common = {
    ...metadataShape,
    codingVersion: z.literal("0.3.2-coding.1"),
    codingSha256: z.string(),
    sdkVersion: z.literal("0.6.0"),
  };
  const inputs = {
    bharosa_api_search: z
      .object({
        query: query.describe(
          "Required nonblank literal search text, even when using group or method filters. For monthly API references, try query nav with group monthly. Maximum 120 raw characters.",
        ),
        limit,
        group: z.enum(["resource", "monthly"]).optional(),
        method: z
          .enum(["GET", "POST", "PUT", "PATCH", "DELETE"])
          .optional()
          .describe(
            "Filter reference documents by their documented HTTP verb. Never executes that method or any network request.",
          ),
      })
      .strict(),
    bharosa_api_details: z
      .object({ operationId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/) })
      .strict(),
    bharosa_examples_search: z
      .object({
        query: query.describe(
          "Required nonblank literal search text, even when using language or operationId filters. Use the operation ID as query to find its examples. Maximum 120 raw characters.",
        ),
        limit,
        language: z
          .enum(["typescript", "javascript", "bash", "json"])
          .optional(),
        operationId: z
          .string()
          .regex(/^[a-zA-Z0-9_-]{1,100}$/)
          .optional(),
      })
      .strict(),
    bharosa_examples_read: z
      .object({
        id: z.string().regex(/^[a-z0-9-]{1,128}$/),
        offset: z.number().int().min(0).max(30000).default(0),
        maxChars: z.number().int().min(1).max(8000).default(4000),
      })
      .strict(),
  };
  const outputs = {
    bharosa_api_search: z
      .object({
        ...common,
        matches: z.array(opSummary).max(20),
        total: z.number().int(),
      })
      .strict(),
    bharosa_api_details: z
      .object({
        ...common,
        operation,
        exampleIds: z.array(z.string()).max(100),
        schemaDocumentIds: z.array(z.string()).max(100),
        notice: z.string(),
      })
      .strict(),
    bharosa_examples_search: z
      .object({
        ...common,
        matches: z.array(exSummary).max(20),
        total: z.number().int(),
      })
      .strict(),
    bharosa_examples_read: z
      .object({
        ...common,
        example: exSummary,
        code: z.string().max(8000),
        setup: z.string().max(8000),
        offset: z.number().int(),
        nextOffset: z.number().int().nullable(),
      })
      .strict(),
  };
  function execute(name, args) {
    if (name === "bharosa_api_search") {
      const matches = search(
        codingBundle.operations.filter(
          (op) =>
            (!args.group || args.group === op.group) &&
            (!args.method || args.method === op.method),
        ),
        args.query,
        (op) =>
          `${op.id} ${op.title} ${op.method} ${op.path} ${JSON.stringify(op.definition)}`,
      );
      return {
        ...provenance,
        matches: matches.slice(0, args.limit).map(summarizeOperation),
        total: matches.length,
      };
    }
    if (name === "bharosa_api_details") {
      const op = codingBundle.operations.find(
        (op) => op.id === args.operationId,
      );
      if (!op)
        return {
          error: {
            code: "operation_not_found",
            message:
              "Choose an operationId from bharosa_api_search. This tool reads specifications; it does not execute endpoints.",
          },
        };
      const refs = [
        ...new Set(
          [
            ...JSON.stringify(op.definition).matchAll(
              /#\/components\/schemas\/([A-Za-z0-9]+)/g,
            ),
          ].map(
            (m) =>
              `schema-${m[1].replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()}`,
          ),
        ),
      ];
      return {
        ...provenance,
        operation: op,
        exampleIds: codingBundle.examples
          .filter((e) => e.operationIds.includes(op.id))
          .map((e) => e.id),
        schemaDocumentIds: refs,
        notice:
          "Specification and synthetic examples only. No HTTP request is made. Documented availability is not proof of a deployed service.",
      };
    }
    if (name === "bharosa_examples_search") {
      const matches = search(
        codingBundle.examples.filter(
          (e) =>
            (!args.language || e.language === args.language) &&
            (!args.operationId || e.operationIds.includes(args.operationId)),
        ),
        args.query,
        (e) => `${e.id} ${e.title} ${e.code} ${e.operationIds.join(" ")}`,
      );
      return {
        ...provenance,
        matches: matches.slice(0, args.limit).map(summarizeExample),
        total: matches.length,
      };
    }
    const e = codingBundle.examples.find((e) => e.id === args.id);
    if (!e)
      return {
        error: {
          code: "example_not_found",
          message:
            "Choose an ID from bharosa_examples_search; paths and URLs are not accepted.",
        },
      };
    if (args.offset > e.code.length)
      return {
        error: {
          code: "invalid_offset",
          message:
            "Follow nextOffset or use an offset within the selected example.",
        },
      };
    const end = args.offset + args.maxChars;
    return {
      ...provenance,
      example: summarizeExample(e),
      code: e.code.slice(args.offset, end),
      setup: e.setup,
      offset: args.offset,
      nextOffset: end < e.code.length ? end : null,
    };
  }
  return { inputs, outputs, execute };
}
