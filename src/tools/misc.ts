import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listApiResources } from "../core/operations/api-resources.js";
import { apply } from "../core/operations/apply.js";
import { explain } from "../core/operations/explain.js";
import { ping } from "../core/operations/ping.js";
import { formatApiResources } from "../core/format/api-resources.js";
import { formatApply } from "../core/format/apply.js";
import { formatExplain } from "../core/format/explain.js";
import { formatPing } from "../core/format/ping.js";
import type { Deps } from "../core/types.js";
import { runTool } from "./result.js";
import { contextSchema, dryRunSchema, namespaceSchema } from "./schemas.js";

export function registerMiscTools(server: McpServer, deps: Deps): string[] {
  server.registerTool(
    "kubectl_apply",
    {
      description: "Apply a Kubernetes YAML manifest from a string or file",
      annotations: { destructiveHint: true },
      inputSchema: {
        manifest: z.string().optional().describe("YAML manifest to apply"),
        filename: z
          .string()
          .optional()
          .describe(
            "Path to a YAML file to apply (optional - use either manifest or filename). The path is read on the machine running the MCP server, so it is rejected when the server runs over a remote (SSE/Streamable HTTP) transport; use 'manifest' to pass the file's contents instead.",
          ),
        namespace: namespaceSchema,
        dryRun: dryRunSchema,
        force: z
          .boolean()
          .optional()
          .default(false)
          .describe("If true, immediately remove resources from API and bypass graceful deletion"),
        context: contextSchema,
      },
    },
    async (args) => runTool("kubectl_apply", async () => formatApply(await apply(deps, args))),
  );

  server.registerTool(
    "explain_resource",
    {
      description: "Get documentation for a Kubernetes resource or field",
      annotations: { readOnlyHint: true },
      inputSchema: {
        resource: z.string().min(1).describe("Resource name or field path (e.g. 'pods' or 'pods.spec.containers')"),
        apiVersion: z.string().optional().describe("API version to use (e.g. 'apps/v1')"),
        recursive: z.boolean().optional().default(false).describe("Print the fields of fields recursively"),
        context: contextSchema,
        output: z
          .enum(["plaintext", "plaintext-openapiv2"])
          .optional()
          .describe("Output format (plaintext or plaintext-openapiv2)"),
      },
    },
    async (args) => runTool("explain_resource", async () => formatExplain(await explain(deps, args))),
  );

  server.registerTool(
    "list_api_resources",
    {
      description: "List the API resources available in the cluster",
      annotations: { readOnlyHint: true },
      inputSchema: {
        apiGroup: z.string().optional().describe("API group to filter by"),
        namespaced: z.boolean().optional().describe("If true, only show namespaced resources"),
        context: contextSchema,
        verbs: z.array(z.string()).optional().describe("List of verbs to filter by"),
        output: z
          .enum(["wide", "name", "no-headers"])
          .optional()
          .describe("Output format (wide, name, or no-headers)"),
      },
    },
    async (args) => runTool("list_api_resources", async () => formatApiResources(await listApiResources(deps, args))),
  );

  server.registerTool(
    "ping",
    {
      description: "Verify that the counterpart is still responsive and the connection is alive.",
      annotations: { readOnlyHint: true },
      inputSchema: {},
    },
    async () => runTool("ping", async () => formatPing(await ping(deps))),
  );

  return ["kubectl_apply", "explain_resource", "list_api_resources", "ping"];
}
