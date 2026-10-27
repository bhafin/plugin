# Bharosa documentation MCP

`bharosa-docs-mcp` provides three read-only tools over 96 bundled Bharosa developer-documentation entries. It does not access accounts, inspect portfolios, execute API operations or require Bharosa credentials.

## Install and check

Use a supported Node.js LTS release >=22.12. Tested with Node 24.22.1 on macOS arm64.

```sh
npm install --ignore-scripts bharosa-docs-mcp@0.1.0
node node_modules/bharosa-docs-mcp/dist/cli.js --check
```

The check initializes a real local stdio connection, discovers the three tools and exercises search, reading and invalid input. It reports `desktopHostVerified: false` because this command alone does not test an AI host. `--stdio` waits silently for protocol messages; `--help` and `--version` do not start a server.

## Claude Code plugin

```sh
claude plugin marketplace add bhafin/plugin
claude plugin install bharosa-docs@bharosa --scope user
```

## Codex plugin

```sh
codex plugin marketplace add bhafin/plugin
codex plugin add bharosa-docs@bharosa
```

Start a new host session with Node LTS and `npx` on PATH. The plugins launch the exact `bharosa-docs-mcp@0.1.0` npm version. Initial installation may download public dependencies; the running documentation server makes no network requests. A host's own model login is separate from this server. No Bharosa key, OAuth connection or account permission is needed.

These repository-marketplace plugins are not a hosted connector or a public directory listing. An npm installation alone does not register either host plugin. The Claude and Codex manifests live under `plugins/bharosa-docs/`; marketplace catalogs are `.claude-plugin/marketplace.json` and `.agents/plugins/marketplace.json`.

For another stdio host, set its command to an absolute supported Node executable and arguments to the absolute installed `dist/cli.js` path followed by `--stdio`. Do not use `npm start`, whose banners can disrupt the protocol stream.

## Tools and boundaries

| Tool          | Inputs                                                 | Result                                                     |
| ------------- | ------------------------------------------------------ | ---------------------------------------------------------- |
| `docs_list`   | offset 0–128, limit 1–20                               | Document metadata and next offset                          |
| `docs_search` | nonblank query, at most 120 raw characters; limit 1–20 | Literal AND search with deterministic ranking and snippets |
| `docs_read`   | listed document ID; offset 0–30000; maxChars 1–8000    | Bounded document text and next offset                      |

Exact IDs and titles rank before title matches; ties follow source order. Search is not semantic or fuzzy. Read IDs are not filesystem paths. Unknown keys, invalid bounds, path-like IDs and malformed requests produce bounded errors. Source paths, hashes, contract and bundle versions accompany responses. No arbitrary filesystem reads, runtime remote fetches or financial-account tools are exposed.

## Documentation provenance and freshness

Software release **0.1.0** contains historical documentation snapshot **0.1.0-prototype.8**, checkpoint **2026-10-27**. These version numbers serve different purposes. Some bundled text describes predecessor rehearsal packages and then-pending releases; consult the current website and this README for subsequent installation changes. Publishing this MCP package does not establish hosted availability of any documented API or consent flow.

The snapshot is generated from the marketing website repository's canonical sources:

- `src/content/guides.ts`: guide prose; SHA-256 `ba182af3625fd46537967caacd6ceeb5a6264f6df03a0e426cb3b55c4a3fe85a`.
- `contracts/openapi.json`: public operations, schemas and authentication reference; SHA-256 `5ae700e29c7f54df12d5634f36cad08785240ee5b019d5921bf0792f53b7866c`.
- `src/content/product.ts`: contract metadata; SHA-256 `e407359ec709344e3eca9bc7f5658a15b2b26dbe6a28496088c0ab540c096632`.

Bundle SHA-256: `9d1d9a58ba177a6676e9c0fcee6835369899e0f2148186ac8a379eb4e5ac1000`. The generator includes 27 guide documents, 23 operations, 45 schemas and one authentication reference. It excludes guide code examples, proposal-only imported guides, private/internal documentation and licensed UI assets. It does not fetch the live website. New website changes require a reviewed checkpoint, regeneration, integrity/version update, tests and a new package release.

## Development

```sh
npm ci --ignore-scripts
npm run build
npm test
npm run format:check
npm run check
```

`src/` contains runtime modules, `tests/` covers protocol and permission boundaries, `assets/docs.json` is the integrity-pinned corpus, and `scripts/` builds or verifies it. `npm-shrinkwrap.json` pins the dependency graph. Source generation is a maintainer operation requiring the reviewed website checkout as sibling `marketing/`; `npm run docs:check` verifies exact source hashes. Ordinary build, tests and runtime need no website checkout or credentials. Never edit the generated corpus directly or repin sources without review.

MIT applies to this project's code and bundled developer documentation. Dependencies retain their original licenses; see `THIRD-PARTY-NOTICES.txt`. Report issues at https://github.com/bhafin/plugin/issues.
