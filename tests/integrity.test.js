import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  symlinkSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
test("tampered or missing bundle refuses startup with actionable non-leaking diagnostics", () => {
  const dir = mkdtempSync(join(tmpdir(), "bharosa-docs-integrity-"));
  try {
    mkdirSync(join(dir, "src"));
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "package.json"), '{"type":"module"}');
    symlinkSync(resolve("node_modules"), join(dir, "node_modules"), "dir");
    for (const file of ["cli.js", "check.js", "server.js", "catalog.js"])
      copyFileSync(resolve("src", file), join(dir, "src", file));
    for (const tampered of [false, true]) {
      if (tampered)
        writeFileSync(
          join(dir, "assets/docs.json"),
          "synthetic-private-value-not-for-logs",
        );
      const run = spawnSync(
        process.execPath,
        [join(dir, "src/cli.js"), "--stdio"],
        { encoding: "utf8", timeout: 3000 },
      );
      assert.equal(run.status, 1);
      assert.equal(run.stdout, "");
      assert.match(run.stderr, /reinstall the reviewed local tarball/);
      assert.doesNotMatch(
        run.stderr,
        /synthetic-private-value| at |ENOENT|SyntaxError/,
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
