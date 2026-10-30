import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
const entry = resolve(process.env.BHAROSA_TEST_CLI ?? "src/cli.js");
function host() {
  const child = spawn(process.execPath, [entry, "--stdio"], {
    cwd: "/tmp",
    env: { PATH: "/usr/bin:/bin" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "",
    counter = 0;
  const queued = [],
    waiters = [];
  child.stderr.on("data", (d) => (stderr += d));
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    const waiter = waiters.shift();
    if (waiter) waiter(message);
    else queued.push(message);
  });
  const exit = new Promise((resolve) =>
    child.once("exit", (code, signal) => resolve({ code, signal })),
  );
  const next = () =>
    new Promise((resolve, reject) => {
      if (queued.length) return resolve(queued.shift());
      const timer = setTimeout(() => reject(Error("response timeout")), 2000);
      waiters.push((value) => {
        clearTimeout(timer);
        resolve(value);
      });
    });
  const raw = (text) => child.stdin.write(text);
  const request = async (method, params) => {
    raw(
      JSON.stringify({ jsonrpc: "2.0", id: ++counter, method, params }) + "\n",
    );
    return next();
  };
  const initialize = async () => {
    const r = await request("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "lifecycle-test", version: "1" },
    });
    assert.equal(r.result.protocolVersion, "2025-11-25");
    raw(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) +
        "\n",
    );
  };
  return {
    child,
    raw,
    next,
    request,
    initialize,
    exit,
    stderr: () => stderr,
    stop: () => {
      lines.close();
      child.kill("SIGKILL");
    },
  };
}
test(
  "malformed frames return bounded errors and recover; initialization gates calls",
  { timeout: 10000 },
  async () => {
    const h = host();
    try {
      const early = await h.request("tools/call", {
        name: "bharosa_docs_list",
        arguments: {},
      });
      assert.equal(
        JSON.parse(early.result.content[0].text).error.code,
        "not_initialized",
      );
      h.raw("{bad sensitive-synthetic-marker}\n");
      const parse = await h.next();
      assert.equal(parse.error.code, -32700);
      assert.equal(parse.id, null);
      assert.doesNotMatch(JSON.stringify(parse), /sensitive-synthetic-marker/);
      for (const text of [
        "[]",
        "null",
        '{"jsonrpc":"2.0","id":1,"method":42}',
      ]) {
        h.raw(text + "\n");
        assert.equal((await h.next()).error.code, -32600);
      }
      await h.initialize();
      assert.equal((await h.request("tools/list", {})).result.tools.length, 7);
      const bad = await h.request("tools/call", { name: false, arguments: {} });
      assert.ok(bad.error);
      assert.equal(
        (
          await h.request("tools/call", {
            name: "bharosa_docs_list",
            arguments: {},
          })
        ).result.structuredContent.total,
        102,
      );
      assert.equal(h.stderr(), "");
      h.child.stdin.end();
      assert.equal((await h.exit).code, 0);
    } finally {
      h.stop();
    }
  },
);
test(
  "oversized input fails closed with no input echo; signals and EOF close cleanly",
  { timeout: 10000 },
  async () => {
    const big = host();
    try {
      big.raw("x".repeat(70 * 1024));
      const exited = await big.exit;
      assert.equal(exited.code, 1);
      assert.match(big.stderr(), /65536 bytes/);
      assert.ok(big.stderr().length < 200);
    } finally {
      big.stop();
    }
    for (const signal of ["SIGTERM", "SIGINT"]) {
      const h = host();
      try {
        await h.initialize();
        h.child.kill(signal);
        assert.equal((await h.exit).code, 0);
        assert.equal(h.stderr(), "");
      } finally {
        h.stop();
      }
    }
  },
);
test(
  "CLI help, version, unknown options and local install check are explicit",
  { timeout: 15000 },
  () => {
    for (const [args, status, pattern] of [
      [["--help"], 0, /Usage:/],
      [["--version"], 0, /0\.3\.0/],
      [["--bad"], 2, /Unknown option/],
    ]) {
      const run = spawnSync(process.execPath, [entry, ...args], {
        encoding: "utf8",
        timeout: 3000,
      });
      assert.equal(run.status, status);
      assert.match(run.stdout + run.stderr, pattern);
    }
    const run = spawnSync(process.execPath, [entry, "--check"], {
      encoding: "utf8",
      timeout: 12000,
    });
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(run.stdout);
    assert.equal(result.status, "pass");
    assert.equal(result.documents, 102);
    assert.equal(result.desktopHostVerified, false);
    assert.equal(run.stderr, "");
  },
);
