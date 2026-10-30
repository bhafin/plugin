# Bharosa

Bharosa helps coding assistants plan and build integrations using an integration skill and seven read-only documentation tools. It cannot access accounts, execute API requests, transfer assets, or run examples.

## Release and scope

Version `0.3.0` is distributed through the bhafin/plugin repository and GitHub release assets. This does not imply public directory acceptance or an npm 0.3.0 publication. Its reviewed snapshot combines website v24 with the public contracts from published `bharosa@0.4.0`, plus its reviewed documentation-only analytics metadata correction: 102 documents, 31 API operations and 121 examples. Both SDK clients default to `https://api.bharosa.finance`; the console is `https://app.bharosa.finance`.

The hosted service is `https://mcp.bharosa.finance/`; `/up` is its health check and `/mcp` is retired. The service serves a pinned documentation snapshot. Check tool response provenance when comparing it with the website.

## Full plugin installation

Extract the reviewed marketplace archive and run from its root:

```sh
codex plugin marketplace add .
codex plugin add bharosa-docs@bharosa
```

For Claude Code, use a session-only full plugin:

```sh
claude --plugin-dir ./plugins/bharosa-docs
```

Or install its local catalogue persistently:

```sh
claude plugin marketplace add .
claude plugin install bharosa-docs@bharosa
```

Start a new session. Ask: “Use the Bharosa integration skill to plan an own-account portfolio dashboard. Retrieve the relevant guides and examples, state their versions, and propose synthetic tests. Do not use real credentials.” In Claude Code the explicit skill is `/bharosa-docs:bharosa-integration`.

These install the skill and MCP connection together. A bare MCP connection does not install the skill. Codex desktop UI installation and Claude web skill loading are not proven by CLI tests. Your AI host needs its own login and usage allowance; the public documentation MCP needs no Bharosa login or key. No public directory approval is required for the local catalogue route.

## Tools

- `bharosa_docs_list`, `bharosa_docs_search`, `bharosa_docs_read`
- `bharosa_api_search`, `bharosa_api_details`
- `bharosa_examples_search`, `bharosa_examples_read`

All responses carry snapshot/source provenance. Search is literal and deterministic. Use returned IDs and pagination; reads are capped at 8,000 UTF-16 code units, with a universal serialized result cap of 131,072 bytes. API method filters select reference text, never an action. The integration skill provides grounded planning; there is no autonomous planner or account-action tool.

## Local server and maintainer checks

Use Node.js 22.12 or later on a supported LTS line. Install the reviewed tarball in an isolated project, then run its CLI directly:

```sh
npm install --ignore-scripts /absolute/path/bharosa-docs-mcp-0.3.0.tgz
node node_modules/bharosa-docs-mcp/dist/cli.js --check
node node_modules/bharosa-docs-mcp/dist/cli.js --stdio
```

No credentials, remote fetch or arbitrary filesystem paths are accepted by tools. Keep stdout reserved for MCP protocol messages.

Source organization: `src/` runtime; `scripts/` pinned generators/build/package verification; `tests/` synthetic protocol/security/example checks; `assets/` generated public corpus; `plugins/` host manifests and skill. The dependency shrinkwrap is committed to the candidate and runtime dependencies are bundled for offline installation. Source development requires the pinned public dependencies; clean archive consumption is separately tested.

```sh
npm run build
npm test
npm run verify:package
BHAROSA_MARKETING_ROOT=/path/to/reviewed/staged/public/input npm run docs:check
BHAROSA_MARKETING_ROOT=/path/to/reviewed/staged/public/input npm run coding:check
```

Generators accept only pinned public source files. Website modules retain marketing source paths; separately staged public SDK contracts retain their original `sdk/test/` paths and hashes. No private first-party contracts or licensed UI assets are included. Changing a source requires a reviewed checkpoint, regeneration, tests and a new release; installed snapshots do not refresh themselves.

The analytics reference includes the reviewed production metadata correction. Synthetic checks are not proof of an authenticated production journey. General delegated onboarding remains unavailable; do not invent OAuth endpoints or grant credentials.

## Support and license

MIT, with dependency notices in `THIRD-PARTY-NOTICES.txt`. Report issues at https://github.com/bhafin/plugin/issues using synthetic examples only. Never post credentials, financial records or private logs. Public docs: https://developers.bharosa.finance/docs/documentation-assistant#hosted . Directory listings remain pending.
