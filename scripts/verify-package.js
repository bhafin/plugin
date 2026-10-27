// Verify an npm archive with an empty cache and no inherited credentials.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const npm = process.env.npm_execpath;
assert.ok(npm, "Run through npm run verify:package");
const work = mkdtempSync(join(tmpdir(), "bharosa-release-check-"));
const consumer = join(work, "consumer");
const home = join(work, "home");
mkdirSync(consumer);
mkdirSync(home);
const userConfig = join(work, "user.npmrc");
const globalConfig = join(work, "global.npmrc");
writeFileSync(userConfig, "");
writeFileSync(globalConfig, "");
const env = { HOME: home, PATH: dirname(process.execPath), TMPDIR: work };
const run = (args, cwd = root) =>
  execFileSync(process.execPath, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: 60000,
  });
const npmArgs = [
  npm,
  "--cache",
  join(work, "cache"),
  "--userconfig",
  userConfig,
  "--globalconfig",
  globalConfig,
  "--offline",
  "--ignore-scripts",
  "--no-audit",
  "--no-fund",
];
const pack = JSON.parse(
  run([...npmArgs, "pack", "--json", "--pack-destination", work]),
)[0];
const artifact = join(work, pack.filename);
for (const file of pack.files) {
  assert.ok(
    !file.path.startsWith("tests/") &&
      !file.path.startsWith("scripts/") &&
      !file.path.startsWith("artifacts/"),
  );
  assert.ok(
    !file.path
      .split("/")
      .some((part) => [".env", ".npmrc", ".git", ".DS_Store"].includes(part)),
  );
}
assert.ok(pack.files.some((f) => f.path === "LICENSE"));
assert.ok(pack.files.some((f) => f.path === "THIRD-PARTY-NOTICES.txt"));
run([...npmArgs, "install", "--prefix", consumer, artifact], consumer);
const installed = join(consumer, "node_modules/bharosa-docs-mcp");
const lock = JSON.parse(
  readFileSync(join(installed, "npm-shrinkwrap.json"), "utf8"),
);
let dependenciesChecked = 0;
for (const [path, entry] of Object.entries(lock.packages)) {
  if (!path || entry.dev) continue;
  assert.equal(
    JSON.parse(readFileSync(join(installed, path, "package.json"), "utf8"))
      .version,
    entry.version,
    path,
  );
  dependenciesChecked++;
}
const check = JSON.parse(
  run([join(installed, "dist/cli.js"), "--check"], consumer),
);
assert.equal(check.status, "pass");
console.log(
  JSON.stringify(
    {
      status: "pass",
      artifact,
      sha256: createHash("sha256").update(readFileSync(artifact)).digest("hex"),
      bytes: pack.size,
      emptyCache: true,
      npmOffline: true,
      dependenciesChecked,
      check,
    },
    null,
    2,
  ),
);
