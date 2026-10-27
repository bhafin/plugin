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
      "docs_list",
      "docs_read",
      "docs_search",
    ]);
    const list = await client.callTool({
      name: "docs_list",
      arguments: { limit: 1 },
    });
    assert.equal(list.structuredContent.total, bundle.docs.length);
    const search = await client.callTool({
      name: "docs_search",
      arguments: { query: "authentication" },
    });
    assert.equal(search.structuredContent.matches[0].id, "authentication");
    const read = await client.callTool({
      name: "docs_read",
      arguments: { id: "authentication", maxChars: 80 },
    });
    assert.equal(read.structuredContent.content.length, 80);
    assert.equal(
      (
        await client.callTool({
          name: "docs_read",
          arguments: { id: "../secret" },
        })
      ).isError,
      true,
    );
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
