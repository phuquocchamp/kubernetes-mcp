/**
 * MCP adapter for the destructive tool group: kubectl_delete, kubectl_generic,
 * cleanup. See docs/REFACTOR-PATTERN.md for the layering contract.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatCleanup } from "../core/format/cleanup.js";
import { formatDelete } from "../core/format/delete.js";
import { formatGeneric } from "../core/format/generic.js";
import { cleanup } from "../core/operations/cleanup.js";
import { deleteResource } from "../core/operations/delete.js";
import { generic } from "../core/operations/generic.js";
import type { Deps } from "../core/types.js";
import { runTool } from "./result.js";
import {
  allNamespacesSchema,
  contextSchema,
  labelSelectorSchema,
  namespaceSchema,
  optionalNameSchema,
  resourceTypeSchema,
} from "./schemas.js";

export function registerDeleteTools(server: McpServer, deps: Deps): string[] {
  server.registerTool(
    "kubectl_delete",
    {
      description: "Delete Kubernetes resources by resource type, name, labels, or from a manifest file",
      annotations: { destructiveHint: true },
      inputSchema: {
        resourceType: resourceTypeSchema.optional(),
        name: optionalNameSchema,
        namespace: namespaceSchema,
        labelSelector: labelSelectorSchema.describe("Delete resources matching this label selector (e.g. 'app=nginx')"),
        manifest: z.string().optional().describe("YAML manifest defining resources to delete (optional)"),
        filename: z
          .string()
          .optional()
          .describe(
            "Path to a YAML file to delete resources from (optional). The path is read on the machine running the MCP server, so it is rejected when the server runs over a remote (SSE/Streamable HTTP) transport; use 'manifest' to pass the file's contents instead.",
          ),
        allNamespaces: allNamespacesSchema.default(false),
        force: z
          .boolean()
          .optional()
          .default(false)
          .describe("If true, immediately remove resources from API and bypass graceful deletion"),
        gracePeriodSeconds: z
          .number()
          .optional()
          .describe("Period of time in seconds given to the resource to terminate gracefully"),
        context: contextSchema,
      },
    },
    async (args) => runTool("kubectl_delete", async () => formatDelete(await deleteResource(deps, args))),
  );

  server.registerTool(
    "kubectl_generic",
    {
      description: "Execute any kubectl command with the provided arguments and flags",
      annotations: { destructiveHint: true },
      inputSchema: {
        command: z.string().min(1).describe("The kubectl command to execute (e.g. patch, rollout, top)"),
        subCommand: z.string().optional().describe("Subcommand if applicable (e.g. 'history' for rollout)"),
        resourceType: resourceTypeSchema.optional().describe("Resource type (e.g. pod, deployment)"),
        name: optionalNameSchema.describe("Resource name"),
        namespace: namespaceSchema,
        allNamespaces: allNamespacesSchema.default(false).describe("If true, run the command across all namespaces"),
        outputFormat: z
          .enum(["json", "yaml", "wide", "name", "custom"])
          .optional()
          .describe("Output format (e.g. json, yaml, wide)"),
        flags: z.record(z.string(), z.unknown()).optional().describe("Command flags as key-value pairs"),
        args: z.array(z.string()).optional().describe("Additional command arguments"),
        context: contextSchema,
      },
    },
    async (args) => runTool("kubectl_generic", async () => formatGeneric(await generic(deps, args))),
  );

  server.registerTool(
    "cleanup",
    {
      description: "Cleanup all managed resources",
      annotations: { destructiveHint: true },
      inputSchema: {},
    },
    async () => runTool("cleanup", async () => formatCleanup(await cleanup(deps))),
  );

  return ["kubectl_delete", "kubectl_generic", "cleanup"];
}
