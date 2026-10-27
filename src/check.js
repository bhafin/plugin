import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { bundle, snapshotSha256 } from "./catalog.js";
export async function runCheck(entry) {
  const client = new Client({
    name: "bharosa-local-install-check",
    version: "1.0.0",
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(entry), "--stdio"],
    stderr: "pipe",
    env: { PATH: process.env.PATH ?? "" },
  });
  let stderr = "";
  transport.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const timeout = setTimeout(() => {
    void client.close();
  }, 10000);
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), [
      "bharosa_api_details",
      "bharosa_api_search",
      "bharosa_docs_list",
      "bharosa_docs_read",
      "bharosa_docs_search",
      "bharosa_examples_read",
      "bharosa_examples_search",
    ]);
    const list = await client.callTool({
      name: "bharosa_docs_list",
      arguments: { limit: 1 },
    });
    assert.equal(list.structuredContent.total, bundle.docs.length);
    const search = await client.callTool({
      name: "bharosa_docs_search",
      arguments: { query: "authentication" },
    });
    assert.equal(search.structuredContent.matches[0].id, "authentication");
    const read = await client.callTool({
      name: "bharosa_docs_read",
      arguments: { id: "authentication", maxChars: 80 },
    });
    assert.equal(read.structuredContent.content.length, 80);
    assert.equal(
      (
        await client.callTool({
          name: "bharosa_docs_read",
          arguments: { id: "../secret" },
        })
      ).isError,
      true,
    );
    const api = await client.callTool({
      name: "bharosa_api_search",
      arguments: { query: "retrieve_account" },
    });
    const op = await client.callTool({
      name: "bharosa_api_details",
      arguments: { operationId: api.structuredContent.matches[0].id },
    });
    assert.equal(op.structuredContent.operation.method, "GET");
    const examples = await client.callTool({
      name: "bharosa_examples_search",
      arguments: {
        query: "retrieve",
        operationId: "retrieve_account",
        language: "typescript",
      },
    });
    const example = await client.callTool({
      name: "bharosa_examples_read",
      arguments: { id: examples.structuredContent.matches[0].id },
    });
    assert.match(example.structuredContent.code, /bharosa.accounts.retrieve/);
    assert.equal(stderr, "");
    return {
      status: "pass",
      scope: "local-protocol-only",
      runtime: process.version,
      server: client.getServerVersion(),
      tools: tools.length,
      documents: bundle.docs.length,
      bundleVersion: bundle.bundleVersion,
      snapshotSha256,
      availability: bundle.availability,
      desktopHostVerified: false,
    };
  } finally {
    clearTimeout(timeout);
    await client.close();
  }
}
