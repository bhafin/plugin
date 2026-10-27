import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { stripTypeScriptTypes } from "node:module";
import { Bharosa } from "bharosa";
import { codingBundle as bundle } from "../src/coding-catalog.js";
test("every exported example passes its advertised validation against published SDK 0.1.0", () => {
  mkdirSync("artifacts", { recursive: true });
  const work = mkdtempSync("artifacts/examples-");
  try {
    const files = [];
    for (const e of bundle.examples) {
      if (e.language === "typescript") {
        const path = `${work}/${e.id}.mts`;
        writeFileSync(
          path,
          "declare const process: {env: Record<string,string|undefined>};\n" +
            e.setup +
            "\n" +
            e.code +
            "\nexport {};",
        );
        files.push(path);
      }
      if (e.language === "bash") {
        const r = spawnSync("/bin/bash", ["-n"], {
          input: e.code,
          encoding: "utf8",
        });
        assert.equal(r.status, 0, e.id + ": " + r.stderr);
      }
      if (e.language === "json")
        assert.doesNotThrow(() => JSON.parse(e.code), e.id);
    }
    writeFileSync(
      `${work}/tsconfig.json`,
      JSON.stringify({
        compilerOptions: {
          noEmit: true,
          strict: true,
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          skipLibCheck: true,
          types: [],
        },
        include: ["*.mts"],
      }),
    );
    const check = spawnSync(
      process.execPath,
      ["node_modules/typescript/bin/tsc", "-p", `${work}/tsconfig.json`],
      { encoding: "utf8" },
    );
    assert.equal(check.status, 0, check.stdout + check.stderr);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
test("46 canonical SDK examples execute only through synthetic transport", async () => {
  const env = {
    BHAROSA_SECRET_KEY: "synthetic-secret",
    BHAROSA_APPLICATION_KEY: "synthetic-app-key",
    BHAROSA_USER_ACCESS_TOKEN: "synthetic-token",
    BHAROSA_ACCOUNT_ID: "acct_0123456789abcdef0123456789abcdef",
    BHAROSA_API_BASE_URL: "https://synthetic.invalid",
  };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  let count = 0;
  for (const e of bundle.examples.filter(
    (e) => e.validation === "strict-typescript-and-synthetic-transport",
  )) {
    const seen = [];
    const delegated = e.id.startsWith("sdk-delegated-");
    class SyntheticClient extends Bharosa {
      constructor(config) {
        super({
          ...config,
          fetch: async (url, init) => {
            assert.equal(new URL(url).origin, env.BHAROSA_API_BASE_URL);
            const op = bundle.operations.find(
              (o) =>
                o.group === "resource" &&
                o.method === init.method &&
                new RegExp(
                  "^" + o.path.replace(/\{[^}]+\}/g, "[^/]+") + "$",
                ).test(new URL(url).pathname),
            );
            assert.ok(op, e.id + " unexpected operation");
            seen.push(op.id);
            assert.equal(
              init.headers.Authorization,
              `Bearer ${delegated ? env.BHAROSA_APPLICATION_KEY : env.BHAROSA_SECRET_KEY}`,
            );
            assert.equal(
              init.headers["Bharosa-User-Authorization"],
              delegated ? "Bearer synthetic-token" : undefined,
            );
            assert.equal(init.redirect, "error");
            return new Response(
              op.sampleStatus === 204
                ? null
                : JSON.stringify(op.sampleResponse),
              {
                status: op.sampleStatus,
                headers: {
                  "Content-Type": "application/json",
                  "Request-Id": "req_synthetic",
                },
              },
            );
          },
        });
      }
    }
    const js = stripTypeScriptTypes(
      e.code.replace('import { Bharosa } from "bharosa";', ""),
    );
    await new AsyncFunction("Bharosa", "process", "crypto", js)(
      SyntheticClient,
      { env },
      { randomUUID: () => "synthetic-example-key" },
    );
    assert.equal(seen.at(-1), e.operationIds[0], e.id);
    assert.ok(seen.length >= 1 && seen.length <= 3);
    count++;
  }
  assert.equal(count, 46);
});
