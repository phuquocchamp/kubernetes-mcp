# Refactor pattern — read this before writing anything

You are converting one group of `src/tools/*.ts` files from the old
schema+dispatcher shape to the layered shape jenkins-mcp uses. This document
is the contract every conversion agent follows. Read it in full before
touching a file.

## The three-file split

Today one tool file (e.g. `src/tools/kubectl-scale.ts`) mixes four things:
JSON Schema, argv building, process spawning, and output shaping, and
`src/index.ts` has a matching dispatcher branch. You are splitting each tool
into three new files and **adding** them — you are not deleting or editing
any existing file. The old dispatcher stays wired and the server keeps
building on the old path until a later integration step flips it over.

1. **`src/core/operations/<name>.ts`** — pure: takes `(deps: Deps, args)`,
   builds the kubectl/helm argv, calls `deps.kubectl(...)` or
   `deps.helm(...)`, parses the output into a typed result, and returns it.
   Never touches MCP types, zod, or text formatting. Throws by letting a
   `KubectlError` from `core/errors.ts` propagate (already thrown by
   `deps.kubectl`/`deps.helm` on failure — you don't normally construct one
   yourself unless you're validating input before the call, e.g. an
   `invalid_input` for a malformed patch body).

2. **`src/core/format/<name>.ts`** — takes exactly one operation's return
   type and renders it to a string. **Keep the exact same JSON shape the
   current tool returns as its `content[0].text`.** Do not reshape it into
   tables or add `next:` hints — that is phase 7 of the plan, explicitly
   deferred and gated. Your formatter can be almost a one-liner:
   `JSON.stringify(result, null, 2)`, or reuse the existing
   summarization logic (e.g. `kubectl-get.ts`'s list-shaping into
   `{ items: [...] }`) verbatim, moved rather than rewritten.

3. **`src/tools/<group>.ts`** — the MCP adapter. Exports
   `registerXTools(server: McpServer, deps: Deps): string[]`, calls
   `server.registerTool(name, { description, inputSchema }, handler)` for
   every tool in your group, and returns the list of tool names it
   registered. Every handler is one line:
   ```ts
   async (args) => runTool("kubectl_scale", async () => formatScale(await scale(deps, args)));
   ```

## What already exists — import it, don't rebuild it

| Need | Import from |
|---|---|
| `Deps` type (`kubectl`, `helm`, `client`, `config`) | `../core/types.js` |
| Async runner: `runKubectl(args, operation, opts?)`, `runHelm(...)` | `../core/kubectl.js` |
| `KubectlError`, `ErrorCode`, `normalizeError` | `../core/errors.js` |
| Argv guards: `assertSafeArgv`, `assertNotFlagLike`, `assertNoDangerousFlags`, `assertNoRemoteFileReads` | `../core/security/argv.js` |
| `isRemoteTransport()` | `../security/transport.js` (unchanged location) |
| `runTool`, `textResult`, `errorResult`, `ToolResult` | `../tools/result.js` |
| Shared zod fields: `namespaceSchema`, `contextSchema`, `resourceTypeSchema`, `nameSchema`, `optionalNameSchema`, `dryRunSchema`, `allNamespacesSchema`, `labelSelectorSchema`, `fieldSelectorSchema` | `../tools/schemas.js` |
| `KubernetesManager` (API clients, resource/port-forward/watch trackers) | `../types.js` |
| Secret masking: `resourceReferencesSecret`, `maskSecretsData` | `../tools/kubectl-get.js` (unchanged for now — your operation file may import these two functions from the OLD file rather than duplicating them; they are pure and have no dispatcher dependency) |
| `getSpawnMaxBuffer` | `../config/max-buffer.js` (unchanged) |

**`deps.kubectl` already applies the argv guards and normalizes errors** —
you do not need to call `assertSafeArgv` yourself unless your operation also
validates something argv-shape-specific before building the command (e.g.
`assertNotFlagLike` on a user-supplied resource name — copy that call from
the existing tool file, it is cheap and correct to keep explicit).

## Do not touch (shared files another agent or the integrator owns)

- `src/index.ts`, `src/server.ts` (doesn't exist yet — the integrator writes it)
- `src/core/index.ts` (barrel — the integrator writes it)
- `package.json`, `tsconfig.json`, `biome.json`
- `src/tools/schemas.ts`, `src/core/types.ts`, `src/core/errors.ts`, `src/core/kubectl.ts`, `src/core/config.ts`
- Any other conversion agent's group of files
- The **old** `src/tools/*.ts` files your group is converting FROM — read
  them, copy logic out of them, but do not edit or delete them. The
  integrator deletes them once every group has landed.

If you need something wired into the server or exported from a shared file,
**do not add it yourself** — state it plainly in your final report (e.g.
"needs `registerScaleTools` called from server.ts, and `formatScale` does
not need a barrel export").

## Worked example — kubectl_scale

**Before** (`src/tools/kubectl-scale.ts`, 127 lines): schema + argv building
+ `execFileSyncSafe` + try/catch + `McpError` all in one file, dispatched
from a `case "kubectl_scale":` branch in `src/index.ts`.

**After** — three files:

```ts
// src/core/operations/scale.ts
import { runKubectl } from "../kubectl.js";
import { assertNotFlagLike } from "../security/argv.js";
import type { Deps } from "../types.js";

export interface ScaleArgs {
  name: string;
  namespace?: string;
  replicas: number;
  resourceType?: string;
  context?: string;
}

export interface ScaleResult {
  kind: string;
  name: string;
  namespace: string;
  replicas: number;
  raw: string;
}

export async function scale(deps: Deps, args: ScaleArgs): Promise<ScaleResult> {
  assertNotFlagLike(args.name, "name");
  const resourceType = args.resourceType ?? "deployment";
  const namespace = args.namespace ?? "default";

  const cmdArgs = ["scale", resourceType, args.name, `--replicas=${args.replicas}`, "-n", namespace];
  if (args.context) cmdArgs.push("--context", args.context);

  const raw = await deps.kubectl(cmdArgs, "kubectl_scale");
  return { kind: resourceType, name: args.name, namespace, replicas: args.replicas, raw };
}
```

```ts
// src/core/format/scale.ts
import type { ScaleResult } from "../operations/scale.js";

export function formatScale(result: ScaleResult): string {
  return JSON.stringify({ success: true, message: result.raw.trim() }, null, 2);
}
```

```ts
// src/tools/write.ts (one of several tools registered by this group)
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatScale } from "../core/format/scale.js";
import { scale } from "../core/operations/scale.js";
import type { Deps } from "../core/types.js";
import { contextSchema, namespaceSchema, nameSchema, resourceTypeSchema } from "./schemas.js";
import { runTool } from "./result.js";

export function registerWriteTools(server: McpServer, deps: Deps): string[] {
  server.registerTool(
    "kubectl_scale",
    {
      description: "Scale a deployment, statefulset or replicaset to a target replica count.",
      inputSchema: {
        name: nameSchema,
        namespace: namespaceSchema,
        replicas: z.number().int().min(0).describe("Target replica count."),
        resourceType: resourceTypeSchema.default("deployment").optional(),
        context: contextSchema,
      },
    },
    async (args) => runTool("kubectl_scale", async () => formatScale(await scale(deps, args))),
  );

  // ...more registerTool calls for the other tools in this group...

  return ["kubectl_scale" /* ...other names... */];
}
```

## Testing

You have no live cluster. Do not attempt to run the existing test suite —
all 42 files in `tests/` need one. Verify your work with:

1. `npx tsc --noEmit` — must pass with zero errors touching your new files.
2. Add argv-assertion unit tests in `src/__tests__/core/operations/<name>.test.ts`,
   same shape as the existing `tests/*.unit.test.ts` files: a fake `Deps`
   whose `kubectl`/`helm` records the argv it was called with and returns a
   canned string, asserting the argv your operation builds is correct for a
   few representative inputs (including one that should trigger
   `assertNotFlagLike`/`assertSafeArgv` rejection, if applicable). Use
   `vi.fn()` for the fake. Do not write tests that spawn a real process.

## Your final report (required)

State plainly:

- The files you created (exact paths).
- The tool names your registrar function returns.
- The exact `registerXTools` export name and its file, for the integrator to import and call from `server.ts`.
- Anything you left out or simplified versus the original tool file, and why.
- Whether `npx tsc --noEmit` passed.
