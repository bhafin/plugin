# Bharosa coding assistant

`bharosa-docs-mcp` supplies seven read-only, `bharosa_`-prefixed MCP tools and a host integration skill. Its bundled canonical references contain 96 documentation entries, 28 API operations and 116 SDK/cURL/guide examples. It does not access accounts, execute API operations or require Bharosa credentials.

## Install and check

Use a supported Node.js LTS release >=22.12. The candidate is tested with Node 24.22.1 on macOS arm64. Version 0.2.0 remains a release candidate until its npm publication is verified; do not assume the registry command below succeeds before that gate.

```sh
npm install --ignore-scripts bharosa-docs-mcp@0.2.0
node node_modules/bharosa-docs-mcp/dist/cli.js --check
```

For a supplied local archive, replace the package specifier with its absolute path. The archive bundles all pinned production dependencies. The check initializes a stdio connection, discovers all seven tools and exercises docs, APIs, examples and invalid input. It reports `desktopHostVerified: false`: this command alone does not test an AI host. `--stdio` waits silently; `--help` and `--version` do not start a server.

## Host plugins

Claude Code:

```sh
claude plugin marketplace add bhafin/plugin
claude plugin install bharosa-docs@bharosa --scope user
```

Codex:

```sh
codex plugin marketplace add bhafin/plugin
codex plugin add bharosa-docs@bharosa
```

Start a new host session with supported Node and `npx` on PATH. The manifests pin `bharosa-docs-mcp@0.2.0`; they require that version to be published before registry-backed launch. The `bharosa-integration` skill helps the coding agent retrieve a contract, select examples, create a grounded plan and test a synthetic app. These repository-marketplace plugins are not hosted connectors or public directory listings. npm installation alone does not register either plugin. A host's own model login is separate; no Bharosa key or OAuth connection is needed.

Manifests and the shared skill are under `plugins/bharosa-docs/`. Marketplace catalogs are `.claude-plugin/marketplace.json` and `.agents/plugins/marketplace.json`. For another stdio host use an absolute supported Node executable with the absolute installed `dist/cli.js` path and `--stdio`. Avoid `npm start`, whose banners can disrupt protocol output.

## Tool contract

| Tool                      | Inputs                                                        | Result                                                              |
| ------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------- |
| `bharosa_docs_list`       | offset 0–128; limit 1–20                                      | Document metadata and next offset                                   |
| `bharosa_docs_search`     | query; limit 1–20                                             | Ranked document matches and snippets                                |
| `bharosa_docs_read`       | document ID; offset 0–30000; maxChars 1–8000                  | Document text chunk                                                 |
| `bharosa_api_search`      | query; limit 1–20; optional method and resource/monthly group | Operation IDs, paths and provenance                                 |
| `bharosa_api_details`     | operationId                                                   | Canonical operation definition, schema-document IDs and example IDs |
| `bharosa_examples_search` | query; limit 1–20; optional language and operationId          | Example metadata and validation scope                               |
| `bharosa_examples_read`   | example ID; offset 0–30000; maxChars 1–8000                   | Code chunk, initialization context and provenance                   |

Queries are nonblank and limited to 120 raw characters before trimming. Search uses case-insensitive literal AND terms, exact ID/title priority and source-order ties; it is not fuzzy or semantic. Reads count UTF-16 code units and return nextOffset. IDs are allowlisted identifiers, not paths. Unknown fields, dangerous own keys, invalid bounds and malformed requests produce bounded errors. There are no unprefixed compatibility aliases, authenticated account tools, remote fetches, arbitrary filesystem reads or code-execution tools.

API references cover 23 public resource operations and five monthly-market operations. Documentation includes 27 guides, the 23 resource references, 45 schemas and authentication. Examples include 62 TypeScript, 52 shell and two JSON snippets. All TypeScript examples compile against published `bharosa@0.1.0`; 46 canonical SDK examples also execute with synthetic transport. Shell examples receive syntax checks, JSON examples parse checks. These checks do not establish live API behavior. API details contain synthetic sample responses where provided by the canonical source.

## Canonical source and updates

Both the developer website and this package derive from the marketing repository. The MCP reads its bundled snapshot, never the live website. Release 0.2.0 uses docs snapshot `0.2.0-docs.1` and coding snapshot `0.2.0-coding.1`, based on the October 27 v11 checkpoint. Some canonical installation prose describes predecessor packages; this README defines this candidate's installation contract. Snapshot availability fields preserve the reviewed source status and do not certify a deployed user journey.

Primary source inputs:

- `src/content/guides.ts`: approved guide prose and examples, SHA256 `738e0f1f1c2078759908225cc76e47b8c3f8dba04446eb1faf82bd99a78969c7`.
- `contracts/openapi.json`: resource operations/schemas/authentication, SHA256 `5ae700e29c7f54df12d5634f36cad08785240ee5b019d5921bf0792f53b7866c`.
- `src/content/product.ts`: endpoint metadata and synthetic fixtures.
- `src/content/examples.ts`, `monthly.ts`, `monthly-schema.json` and their pinned public-content dependencies: canonical code examples and monthly definitions.

`scripts/source-checkpoint.json` and `scripts/coding-source-checkpoint.json` record all input hashes. Generated assets retain source paths, selectors/pointers, hashes and version metadata. Proposal-only guides, private/internal docs, account data and licensed UI assets are excluded. Website changes require review, checkpoint updates, deterministic regeneration, tests and a new package release. Never maintain a divergent hand-edited copy of the docs.

## Development and verification

Use Node 24 LTS for source generation and development example tests.

```sh
npm ci --ignore-scripts
npm run build
npm test
npm run format:check
npm run check
npm run verify:package
```

`src/` contains runtime modules; `tests/` covers examples, protocol, malformed requests, input boundaries and integrity. `verify:package` installs the archive in npm offline mode with an empty cache and checks every bundled production dependency version plus all seven tool families. It does not configure a desktop host. Runtime dependencies are bundled with their licenses; SDK/compiler dev dependencies are not shipped.

Maintainers need the reviewed marketing checkout, selected explicitly:

```sh
BHAROSA_MARKETING_ROOT=/absolute/path/to/marketing node scripts/snapshot.js
BHAROSA_MARKETING_ROOT=/absolute/path/to/marketing node scripts/coding-snapshot.js
BHAROSA_MARKETING_ROOT=/absolute/path/to/marketing npm run docs:check
BHAROSA_MARKETING_ROOT=/absolute/path/to/marketing npm run coding:check
```

Ordinary build, tests and runtime need no website checkout or credentials. MIT applies to this project's code and bundled developer documentation. Dependencies retain their original licenses; see `THIRD-PARTY-NOTICES.txt`. Issues: https://github.com/bhafin/plugin/issues.
