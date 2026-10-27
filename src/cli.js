#!/usr/bin/env node
const version = "0.2.0";
const args = process.argv.slice(2);
const mode = args[0] ?? "--stdio";
if (
  args.length > 1 ||
  !["--stdio", "--check", "--version", "--help"].includes(mode)
) {
  console.error(
    "Unknown option. Use --help, --version, --check, or --stdio (default).",
  );
  process.exitCode = 2;
} else if (mode === "--help") {
  console.log(
    `Bharosa documentation MCP ${version}\nLocal documentation only; no credentials, accounts or network service.\n\nUsage: bharosa-docs-mcp [--stdio | --check | --version | --help]\n  --stdio    Serve MCP on stdin/stdout (default; no banner).\n  --check    Validate this install and run a local MCP round trip; print JSON.\n  --version  Print the package version.\n\nRequires Node >=22.12 in a supported LTS line. Configure the host to run this executable with --stdio; do not use npm start. No desktop settings are changed by any command.`,
  );
} else if (mode === "--version") {
  console.log(version);
} else if (
  Number(process.versions.node.split(".")[0]) < 22 ||
  (Number(process.versions.node.split(".")[0]) === 22 &&
    Number(process.versions.node.split(".")[1]) < 12)
) {
  console.error(
    "Node >=22.12 in a supported LTS line is required. Select that Node executable and retry --check.",
  );
  process.exitCode = 1;
} else {
  try {
    if (mode === "--check") {
      const { runCheck } = await import("./check.js");
      console.log(
        JSON.stringify(
          await runCheck(new URL("./cli.js", import.meta.url)),
          null,
          2,
        ),
      );
    } else await import("./server.js");
  } catch {
    console.error(
      "Bharosa docs failed to start or validate. Use Node >=22.12 LTS, reinstall the reviewed local tarball with dependencies, and rerun --check. Do not edit bundled documentation to repair it.",
    );
    process.exitCode = 1;
  }
}
