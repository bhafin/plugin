import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test(
  "official SDK client negotiates stdio and exercises the installed tool contract",
  { timeout: 15000 },
  async () => {
    const client = new Client({
      name: "bharosa-local-test-host",
      version: "1.0.0",
    });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve(process.env.BHAROSA_TEST_SERVER ?? "src/server.js")],
      cwd: "/tmp",
      stderr: "pipe",
      env: { PATH: process.env.PATH ?? "" },
    });
    let stderr = "";
    transport.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    try {
      await client.connect(transport);
      assert.equal(client.getServerVersion().name, "bharosa-docs-local");
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
      for (const tool of tools) {
        assert.equal(tool.annotations.readOnlyHint, true);
        assert.equal(tool.annotations.openWorldHint, false);
        assert.equal(tool.inputSchema.type, "object");
        assert.equal(tool.inputSchema.additionalProperties, false);
      }
      assert.equal(
        tools.find((t) => t.name === "bharosa_docs_read").inputSchema.properties
          .maxChars.maximum,
        8000,
      );
      const list = await client.callTool({
        name: "bharosa_docs_list",
        arguments: {},
      });
      assert.equal(list.structuredContent.total, 96);
      assert.deepEqual(
        JSON.parse(list.content[0].text),
        list.structuredContent,
      );
      const found = await client.callTool({
        name: "bharosa_docs_search",
        arguments: { query: "OAuth", limit: 20 },
      });
      assert.ok(
        found.structuredContent.matches.some((d) => d.id === "authentication"),
      );
      const read = await client.callTool({
        name: "bharosa_docs_read",
        arguments: { id: "authentication", maxChars: 100 },
      });
      assert.equal(read.structuredContent.content.length, 100);
      for (const [name, args] of [
        ["bharosa_docs_read", { id: "../secret" }],
        ["bharosa_docs_read", { id: "missing" }],
        ["bharosa_docs_list", { limit: 1000 }],
        ["bharosa_docs_list", { path: "/etc/passwd" }],
        ["bharosa_docs_search", { query: "" }],
        ["nonexistent", {}],
      ]) {
        const response = await client.callTool({ name, arguments: args });
        assert.equal(response.isError, true);
      }
      assert.equal(stderr, "");
    } finally {
      await client.close();
    }
  },
);
