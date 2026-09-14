import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatNodeManagement } from "../core/format/node.js";
import { manageNode } from "../core/operations/node.js";
import type { Deps } from "../core/types.js";
import { runTool } from "./result.js";

/**
 * Registers the node_management tool: cordon, drain, and uncordon nodes.
 * This is a destructive tool (it can drain a node) — see manageNode's
 * confirmDrain safety gate in core/operations/node.ts, kept exactly as the
 * original src/tools/node-management.ts.
 */
export function registerNodeTools(server: McpServer, deps: Deps): string[] {
  server.registerTool(
    "node_management",
    {
      description: "Manage Kubernetes nodes with cordon, drain, and uncordon operations",
      annotations: {
        destructiveHint: true,
      },
      inputSchema: {
        operation: z.enum(["cordon", "drain", "uncordon"]).describe("Node operation to perform"),
        nodeName: z
          .string()
          .optional()
          .describe("Name of the node to operate on (required for cordon, drain, uncordon)"),
        force: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            "Force the operation even if there are pods not managed by a ReplicationController, ReplicaSet, Job, DaemonSet or StatefulSet (for drain operation)",
          ),
        gracePeriod: z
          .number()
          .optional()
          .default(-1)
          .describe(
            "Period of time in seconds given to each pod to terminate gracefully (for drain operation). If set to -1, uses the kubectl default grace period.",
          ),
        deleteLocalData: z
          .boolean()
          .optional()
          .default(false)
          .describe("Delete local data even if emptyDir volumes are used (for drain operation)"),
        ignoreDaemonsets: z
          .boolean()
          .optional()
          .default(true)
          .describe("Ignore DaemonSet-managed pods (for drain operation)"),
        timeout: z
          .string()
          .optional()
          .default("0")
          .describe(
            "The length of time to wait before giving up (for drain operation, e.g., '5m', '1h')",
          ),
        dryRun: z
          .boolean()
          .optional()
          .default(false)
          .describe("Show what would be done without actually doing it (for drain operation)"),
        confirmDrain: z
          .boolean()
          .optional()
          .default(false)
          .describe("Explicit confirmation to drain the node (required for drain operation)"),
      },
    },
    async (args) =>
      runTool("node_management", async () => formatNodeManagement(await manageNode(deps, args))),
  );

  return ["node_management"];
}
