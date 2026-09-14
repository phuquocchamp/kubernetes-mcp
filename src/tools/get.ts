import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatGet } from "../core/format/get.js";
import { get } from "../core/operations/get.js";
import type { Deps } from "../core/types.js";
import { runTool } from "./result.js";
import { contextSchema, fieldSelectorSchema, labelSelectorSchema, namespaceSchema, resourceTypeSchema } from "./schemas.js";

export function registerGetTools(server: McpServer, deps: Deps): string[] {
  server.registerTool(
    "kubectl_get",
    {
      description: "Get or list Kubernetes resources by resource type, name, and optionally namespace",
      annotations: {
        readOnlyHint: true,
      },
      inputSchema: {
        resourceType: resourceTypeSchema.describe(
          "Type of resource to get (e.g., pods, deployments, services, configmaps, events, etc.)",
        ),
        name: z
          .string()
          .optional()
          .describe("Name of the resource (optional - if not provided, lists all resources of the specified type)"),
        namespace: namespaceSchema,
        output: z
          .enum(["json", "yaml", "wide", "name", "custom"])
          .optional()
          .default("json")
          .describe("Output format"),
        allNamespaces: z.boolean().optional().default(false).describe("If true, list resources across all namespaces"),
        labelSelector: labelSelectorSchema,
        fieldSelector: fieldSelectorSchema,
        sortBy: z
          .string()
          .optional()
          .describe("Sort events by a field (default: lastTimestamp). Only applicable for events."),
        context: contextSchema,
      },
    },
    async (args) => runTool("kubectl_get", async () => formatGet(await get(deps, args))),
  );

  return ["kubectl_get"];
}
