import "../src/catalog.js";
import { mkdirSync, copyFileSync, chmodSync } from "node:fs";
mkdirSync(new URL("../dist/", import.meta.url), { recursive: true });
for (const file of [
  "server.js",
  "catalog.js",
  "cli.js",
  "check.js",
  "coding-catalog.js",
])
  copyFileSync(
    new URL(`../src/${file}`, import.meta.url),
    new URL(`../dist/${file}`, import.meta.url),
  );
chmodSync(new URL("../dist/server.js", import.meta.url), 0o755);
chmodSync(new URL("../dist/cli.js", import.meta.url), 0o755);
