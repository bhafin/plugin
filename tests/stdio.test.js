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
        "docs_list",
        "docs_read",
        "docs_search",
      ]);
      for (const tool of tools) {
        assert.equal(tool.annotations.readOnlyHint, true);
        assert.equal(tool.annotations.openWorldHint, false);
        assert.equal(tool.inputSchema.type, "object");
        assert.equal(tool.inputSchema.additionalProperties, false);
      }
      assert.equal(
        tools.find((t) => t.name === "docs_read").inputSchema.properties
          .maxChars.maximum,
        8000,
      );
      const list = await client.callTool({ name: "docs_list", arguments: {} });
      assert.equal(list.structuredContent.total, 96);
      assert.deepEqual(
        JSON.parse(list.content[0].text),
        list.structuredContent,
      );
      const found = await client.callTool({
        name: "docs_search",
        arguments: { query: "OAuth", limit: 20 },
      });
      assert.ok(
        found.structuredContent.matches.some((d) => d.id === "authentication"),
      );
      const read = await client.callTool({
        name: "docs_read",
        arguments: { id: "authentication", maxChars: 100 },
      });
      assert.equal(read.structuredContent.content.length, 100);
      for (const [name, args] of [
        ["docs_read", { id: "../secret" }],
        ["docs_read", { id: "missing" }],
        ["docs_list", { limit: 1000 }],
        ["docs_list", { path: "/etc/passwd" }],
        ["docs_search", { query: "" }],
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
