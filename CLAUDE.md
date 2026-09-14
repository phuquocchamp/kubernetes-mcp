# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Build and Development

- `bun run build` - Compile TypeScript to dist/ and make executables
- `bun run dev` - Start TypeScript compiler in watch mode for development
- `bun run start` - Run the compiled server from dist/index.js
- `bun run test` - Run the unit test project (no cluster required)

### Testing and Quality

- `bun run test` - Runs the **unit** Vitest project only: `src/__tests__/**` plus the handful of cluster-free `tests/*.unit.test.ts` files. This is the suite CI and every PR must keep green; it needs no Kubernetes cluster and no kubectl/helm binaries.
- `bun run test:e2e` - Runs the **e2e** Vitest project: the rest of `tests/*.test.ts`. These require an active Kubernetes cluster connection (custom sequencer runs `kubectl.test.ts` last since it modifies cluster state) and are not expected to pass without one.
- `bun run test:all` - Runs both projects together (equivalent to the old bare `vitest run`).
- Tests have 120s timeout and 60s hook timeout due to Kubernetes operations
- Use `npx @modelcontextprotocol/inspector node dist/index.js` for local testing with Inspector
- Always run single test based on with area you are working on. running all tests will take a long time.

### Local Development Testing

- `bun run chat` - Test locally with mcp-chat CLI client
- For Claude Desktop testing, point to local `dist/index.js` build

## Architecture Overview

This is an MCP (Model Context Protocol) server that provides Kubernetes cluster management capabilities. The server connects to Kubernetes clusters via kubectl and offers both read-only and destructive operations.

### Core Components

**KubernetesManager** (`src/utils/kubernetes-manager.ts`): Central class managing Kubernetes API connections, resource tracking, port forwards, and watches. Handles kubeconfig loading from multiple sources in priority order.

**Tool Structure**: Each Kubernetes operation is split across three layers (the `jenkins-mcp` pattern — see `docs/REFACTOR-PATTERN.md` for the full contract and a worked example):

- `src/core/operations/*.ts` — pure logic: builds the kubectl/helm argv and parses the result. No MCP or Zod knowledge; takes a `Deps` object (`kubectl`, `helm`, `client`, `config`) so it can be unit-tested with fakes, no live cluster or process spawn.
- `src/core/format/*.ts` — turns an operation's result into the text the tool returns.
- `src/tools/*.ts` — thin `registerTool` adapters (Zod schemas + wiring) that call into `core/operations` and `core/format`. Each file exports a `registerXTools(server, deps): string[]` registrar, listed in `REGISTRARS` in `src/server.ts`.

Tools are divided into: kubectl operations (get, describe, apply, delete, create, etc.), Helm operations (install, upgrade, uninstall charts), and specialized operations (port forwarding, scaling, rollouts).

**Resource Handlers** (`src/resources/handlers.ts`): Manage MCP resource endpoints for dynamic data retrieval.

**Configuration System** (`src/core/config.ts`): Zod schema, validation and loading for all server config (tool gating, secret masking, transport/DNS-rebinding options, etc.), consumed as `deps.config` by operations.

### Key Architecture Patterns

- **Tool Gating**: `src/server.ts` wraps `McpServer` in a `Proxy` (`gatedServer`) that intercepts `.registerTool` — a forbidden tool (per `ALLOW_ONLY_NON_DESTRUCTIVE_TOOLS`, `ALLOW_ONLY_READONLY_TOOLS`, or `ALLOWED_TOOLS`) is **never registered**, not registered-then-refused. `isToolAllowed`/`findUnknownToolNames` in the same file are the source of truth; `src/__tests__/mcp/safety.test.ts` asserts the exact tool-name sets this produces.
- **Unified kubectl API**: `core/kubectl.ts` (`runKubectl`/`runHelm`) is the single async `execFile` choke point — argv-injection guards (`security/kubectl-flags.ts`, re-exported at `core/security/argv.ts`) and OpenTelemetry span instrumentation (`core/telemetry.ts`) both live here, not scattered per-tool.
- **Resource Tracking**: All created resources are tracked for cleanup capabilities
- **Transport Flexibility**: Supports both StdioTransport and SSE/Streamable HTTP transport for different integration scenarios. Note: `createServer` (`src/server.ts`) currently builds its own `KubernetesManager` internally rather than taking one as a parameter — fine for the current one-process-per-connection stdio/CLI usage, but a future per-session HTTP server would get a fresh manager per session. Take the manager as a parameter if/when that's built.

### Request Flow

1. Client sends MCP request via transport layer
2. Server filters available tools based on destructive/non-destructive mode
3. Request routed to appropriate handler (tools/resources)
4. KubernetesManager executes Kubernetes API calls
5. Responses formatted and returned through transport

## Development Guidelines

### Adding New Tools

Follow `docs/REFACTOR-PATTERN.md`. In short:

- Add the operation to `src/core/operations/<name>.ts` (pure argv-building + parsing, takes `Deps`) and, if needed, a formatter in `src/core/format/<name>.ts`.
- Register it with a Zod schema in the relevant `src/tools/*.ts` registrar (or add a new registrar and list it in `REGISTRARS` in `src/server.ts`).
- Add its name to `ALL_TOOL_NAMES` in `src/server.ts`, and to `READONLY_TOOL_NAMES`/`DESTRUCTIVE_TOOL_NAMES` there if it's read-only or destructive — that's what drives the gating in `isToolAllowed`.
- Write a unit test for the operation under `src/__tests__/core/operations/` using a `fakeDeps()` helper (see existing files for the pattern) — no live cluster needed.
- Include comprehensive error handling for Kubernetes API failures (`core/errors.ts`'s `normalizeError`/`KubectlError`).

### Testing Strategy

- Unit tests (`bun run test`) cover operation logic and schema validation against faked `Deps` — no cluster needed. This is the suite that must stay green.
- E2E tests (`bun run test:e2e`) verify actual Kubernetes operations against a live cluster; custom test sequencer ensures `kubectl.test.ts` runs last (it modifies cluster state).
- See `vitest.config.ts` for the unit/e2e project split (by `tests/**/*.unit.test.ts` naming vs. everything else in `tests/`).

### Configuration Handling

- Server loads kubeconfig from multiple sources: KUBECONFIG_YAML env var, KUBECONFIG path, or ~/.kube/config
- Supports multiple kubectl contexts with context switching capabilities
- Environment variables control server behavior (non-destructive mode, custom kubeconfig paths)

## Kubernetes Integration Details

The server requires:

- kubectl installed and accessible in PATH
- Valid kubeconfig with configured contexts
- Active Kubernetes cluster connection
- Helm v3 for chart operations (optional)

**Non-destructive mode** disables: kubectl_delete, uninstall_helm_chart, cleanup operations, and kubectl_generic (which could contain destructive commands).

## Release Process

Releases are fully automated by the CD workflow (`.github/workflows/cd.yml`), which triggers on any pushed tag matching `v*`. **The only manual step is creating the tag and a matching GitHub release** — the agent that merges a release-worthy PR should do this directly once the PR is merged.

**Do NOT bump the version numbers yourself.** CD owns the version bump: on tag push it runs `npm run version:update`, updates the version in every version-bearing file (`package.json`, `src/config/server-config.ts`, `manifest.json`, `CITATION.cff`, `README.md`, `gemini-extension.json`, and the Helm chart), commits `Bump version to <x.y.z>` to `main`, then builds and publishes to npm, GHCR/Helm, and Docker Hub, and uploads the release assets. Editing those files by hand collides with that step and breaks the release. Leave the source at the previous version.

To cut a release, after the PR is merged to `main`:

- Create the tag and GitHub release targeting the current tip of `main` (the merge commit):
  - Tag name: `v<x.y.z>` where `<x.y.z>` is the next patch version (e.g. `v4.0.2` after `v4.0.1`). This must match the version CD will compute, or the release-asset upload will fail.
  - Release title: `Release v<x.y.z>` (e.g. `Release v4.0.2`)
  - Release notes: one or two terse lines describing the change, referencing the PR number (e.g. `(#332)`), matching the style of prior releases.

  Example: `gh release create v4.0.2 --target main --title "Release v4.0.2" --notes "..."` (this creates the `v4.0.2` tag, which triggers CD).

That single tag/release is all that's needed — CD handles the version bump, publish, and asset uploads from there.

## Security Fixes and Coordinated Disclosure

When a change fixes a security issue tracked by a GHSA advisory or CVE, keep the disclosure in the maintainer's hands. Do **not** put any of the following into public channels — the PR title, PR description, PR comments, commit messages, or release notes:

- the GHSA or CVE identifier
- the vulnerability details, attack vector, impact, or affected-secret list
- a proof-of-concept or reproduction steps

Instead, describe the change neutrally as a hardening/robustness improvement — what the code now does, not how it could be exploited. The GHSA advisory and CVE are drafted and published separately by the maintainer; premature disclosure in a public PR or release undermines coordinated disclosure.

Once the advisory is public, the release notes may be updated to reference the GHSA/CVE identifier (older releases cite them this way).
