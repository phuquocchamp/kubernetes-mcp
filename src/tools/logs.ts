import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatLogs } from "../core/format/logs.js";
import { logs } from "../core/operations/logs.js";
import type { Deps } from "../core/types.js";
import { runTool } from "./result.js";
import { contextSchema, labelSelectorSchema, namespaceSchema } from "./schemas.js";

export function registerLogsTools(server: McpServer, deps: Deps): string[] {
  server.registerTool(
    "kubectl_logs",
    {
      description: "Get logs from Kubernetes resources like pods, deployments, or jobs",
      annotations: {
        readOnlyHint: true,
      },
      inputSchema: {
        resourceType: z
          .enum(["pod", "deployment", "job", "cronjob"])
          .describe("Type of resource to get logs from"),
        name: z.string().min(1).describe("Name of the resource"),
        namespace: namespaceSchema,
        container: z
          .string()
          .optional()
          .describe("Container name (required when pod has multiple containers)"),
        tail: z.number().optional().describe("Number of lines to show from end of logs"),
        since: z
          .string()
          .optional()
          .describe("Show logs since relative time (e.g. '5s', '2m', '3h')"),
        sinceTime: z.string().optional().describe("Show logs since absolute time (RFC3339)"),
        timestamps: z.boolean().optional().default(false).describe("Include timestamps in logs"),
        previous: z
          .boolean()
          .optional()
          .default(false)
          .describe("Include logs from previously terminated containers"),
        follow: z
          .boolean()
          .optional()
          .default(false)
          .describe("Follow logs output (not recommended, may cause timeouts)"),
        labelSelector: labelSelectorSchema,
        context: contextSchema,
      },
    },
    async (args) => runTool("kubectl_logs", async () => formatLogs(await logs(deps, args))),
  );

  return ["kubectl_logs"];
}
