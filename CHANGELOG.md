# 0.3.0

Full Bharosa plugin with hosted root MCP and integration skill for published SDK 0.4.0. Reviewed public corpus includes 102 documents, 31 operations and 121 examples, including Growth analytics reference. Documentation-only; no account access or API execution. Direct installation does not require public directory acceptance. Server archive is a GitHub release asset; no npm 0.3.0 publication is implied.

# Changelog

## 0.2.0

- Replace the original three unprefixed tools with seven `bharosa_` tools. Add canonical API search/details and paged SDK/cURL/guide examples.
- Add a shared `bharosa-integration` skill for Codex and Claude Code: discover the contract, select examples, plan with citations, implement and test synthetic requests.
- Generate 96 docs, 28 API operations and 116 examples from reviewed marketing sources. Preserve exact source hashes and deterministic generation; exclude private and proposal-only material.
- Verify 62 TypeScript examples against published `bharosa@0.1.0`, including 46 synthetic SDK transport executions; check 52 shell snippets and two JSON snippets.
- Bundle pinned production dependencies to fix the 0.1.0 clean-install dependency drift. Empty-cache offline install verifies all 95 versions.
- Extend protocol, malformed-request, dangerous-key and integrity checks to the expanded contract. No credentials, account operations or remote fetching added.

Version 0.2.0 requires new host sessions and prefixed tool names. Registry-backed plugin launch requires verified npm publication. Local protocol checks do not establish actual host or hosted API availability.

## 0.1.0

Initial public GitHub archive contained three documentation lookup tools. A fresh install exposed transitive dependency drift; this immutable predecessor is not recommended. It was not published to npm.
