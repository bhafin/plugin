#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./mcp-server.js";
const server = createServer();
const transport = new StdioServerTransport(process.stdin, process.stdout, {
  maxBufferSize: 64 * 1024,
});
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await server.close();
  process.stdin.destroy();
}
process.stdin.once("end", () => {
  void close();
});
process.once("SIGTERM", () => {
  void close();
});
process.once("SIGINT", () => {
  void close();
});
server.server.onerror = (error) => {
  if (error instanceof SyntaxError || error?.name === "ZodError") {
    void transport
      .send({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: error instanceof SyntaxError ? -32700 : -32600,
          message:
            error instanceof SyntaxError
              ? "Invalid JSON. Send one JSON-RPC object per line."
              : "Invalid JSON-RPC message. Use a request object with jsonrpc, id, method and optional params.",
        },
      })
      .catch(() => {
        void close();
      });
  } else {
    console.error(
      "MCP input/transport failure. Keep buffered input below 65536 bytes and reconnect.",
    );
    process.exitCode = 1;
    void close();
  }
};
try {
  await server.connect(transport);
} catch {
  console.error(
    "Bharosa documentation MCP failed to start. Check the local installation and bundled snapshot.",
  );
  process.exitCode = 1;
}
