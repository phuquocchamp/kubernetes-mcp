import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatContext, formatReconnect } from "../core/format/context.js";
import { kubectlContext, kubectlReconnect } from "../core/operations/context.js";
import type { Deps } from "../core/types.js";
import { runTool } from "./result.js";

export function registerContextTools(server: McpServer, deps: Deps): string[] {
  server.registerTool(
    "kubectl_context",
    {
      description: "Manage Kubernetes contexts - list, get, or set the current context",
      annotations: {
        readOnlyHint: true,
      },
      inputSchema: {
        operation: z
          .enum(["list", "get", "set"])
          .default("list")
          .describe("Operation to perform: list contexts, get current context, or set current context"),
        name: z.string().optional().describe("Name of the context to set as current (required for set operation)"),
        showCurrent: z
          .boolean()
          .default(true)
          .optional()
          .describe("When listing contexts, highlight which one is currently active"),
        detailed: z.boolean().default(false).optional().describe("Include detailed information about the context"),
        output: z.enum(["json", "yaml", "name", "custom"]).default("json").optional().describe("Output format"),
      },
    },
    async (args) => runTool("kubectl_context", async () => formatContext(await kubectlContext(deps, args))),
  );

  server.registerTool(
    "kubectl_reconnect",
    {
      description:
        "Reconnect to the Kubernetes API server by recreating all API clients. Use this after cluster upgrades (e.g., EKS control plane upgrades that rotate ENIs/IPs) to force fresh DNS resolution and new TCP connections.",
      annotations: {
        readOnlyHint: false,
      },
      inputSchema: {},
    },
    async () => runTool("kubectl_reconnect", async () => formatReconnect(await kubectlReconnect(deps))),
  );

  return ["kubectl_context", "kubectl_reconnect"];
}
