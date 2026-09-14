import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatPatch } from "../core/format/patch.js";
import { formatRollout } from "../core/format/rollout.js";
import { formatScale } from "../core/format/scale.js";
import { patch } from "../core/operations/patch.js";
import { rollout } from "../core/operations/rollout.js";
import { scale } from "../core/operations/scale.js";
import type { Deps } from "../core/types.js";
import { runTool } from "./result.js";
import {
  contextSchema,
  dryRunSchema,
  nameSchema,
  namespaceSchema,
  resourceTypeSchema,
} from "./schemas.js";

export function registerWriteTools(server: McpServer, deps: Deps): string[] {
  server.registerTool(
    "kubectl_patch",
    {
      description:
        "Update field(s) of a resource using strategic merge patch, JSON merge patch, or JSON patch",
      inputSchema: {
        resourceType: resourceTypeSchema,
        name: nameSchema,
        namespace: namespaceSchema,
        patchType: z.enum(["strategic", "merge", "json"]).default("strategic").optional(),
        patchData: z.object({}).passthrough().optional().describe("Patch data as a JSON object."),
        patchFile: z
          .string()
          .optional()
          .describe(
            "Path to a file containing the patch data (alternative to patchData). The path is read on the machine running the MCP server, so it is rejected when the server runs over a remote (SSE/Streamable HTTP) transport; use 'patchData' to pass the patch contents instead.",
          ),
        dryRun: dryRunSchema,
        context: contextSchema,
      },
    },
    async (args) => runTool("kubectl_patch", async () => formatPatch(await patch(deps, args))),
  );

  server.registerTool(
    "kubectl_scale",
    {
      description: "Scale a deployment, statefulset or replicaset to a target replica count.",
      inputSchema: {
        name: nameSchema,
        namespace: namespaceSchema,
        replicas: z.number().int().min(0).describe("Number of replicas to scale to."),
        resourceType: resourceTypeSchema.default("deployment").optional(),
        context: contextSchema,
      },
    },
    async (args) => runTool("kubectl_scale", async () => formatScale(await scale(deps, args))),
  );

  server.registerTool(
    "kubectl_rollout",
    {
      description: "Manage the rollout of a resource (e.g., deployment, daemonset, statefulset)",
      inputSchema: {
        subCommand: z
          .enum(["history", "pause", "restart", "resume", "status", "undo"])
          .default("status")
          .describe("Rollout subcommand to execute."),
        resourceType: z
          .enum(["deployment", "daemonset", "statefulset"])
          .default("deployment")
          .describe("Type of resource to manage rollout for."),
        name: nameSchema,
        namespace: namespaceSchema,
        revision: z.number().optional().describe("Revision to rollback to (for undo subcommand)."),
        toRevision: z
          .number()
          .optional()
          .describe("Revision to roll back to (for history subcommand)."),
        timeout: z
          .string()
          .optional()
          .describe("The length of time to wait before giving up (e.g., '30s', '1m', '2m30s')."),
        watch: z
          .boolean()
          .default(false)
          .optional()
          .describe("Watch the rollout status in real-time until completion."),
        context: contextSchema,
      },
    },
    async (args) =>
      runTool("kubectl_rollout", async () => formatRollout(await rollout(deps, args))),
  );

  return ["kubectl_patch", "kubectl_scale", "kubectl_rollout"];
}
