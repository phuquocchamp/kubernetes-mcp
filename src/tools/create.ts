import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatCreate } from "../core/format/create.js";
import { create } from "../core/operations/create.js";
import type { Deps } from "../core/types.js";
import { runTool } from "./result.js";
import {
  contextSchema,
  dryRunSchema,
  namespaceSchema,
  optionalNameSchema,
  resourceTypeSchema,
} from "./schemas.js";

export function registerCreateTools(server: McpServer, deps: Deps): string[] {
  server.registerTool(
    "kubectl_create",
    {
      description:
        "Create Kubernetes resources using various methods (from file or using subcommands)",
      inputSchema: {
        // General options
        dryRun: dryRunSchema,
        output: z
          .enum([
            "json",
            "yaml",
            "name",
            "go-template",
            "go-template-file",
            "template",
            "templatefile",
            "jsonpath",
            "jsonpath-as-json",
            "jsonpath-file",
          ])
          .default("yaml")
          .optional()
          .describe(
            "Output format. One of: json|yaml|name|go-template|go-template-file|template|templatefile|jsonpath|jsonpath-as-json|jsonpath-file",
          ),
        validate: z
          .boolean()
          .default(true)
          .optional()
          .describe("If true, validate resource schema against server schema"),

        // Create from file method
        manifest: z.string().optional().describe("YAML manifest to create resources from"),
        filename: z
          .string()
          .optional()
          .describe(
            "Path to a YAML file to create resources from. The path is read on the machine running the MCP server, so it is rejected when the server runs over a remote (SSE/Streamable HTTP) transport; use 'manifest' to pass the file's contents instead.",
          ),

        // Resource type to create (determines which subcommand to use)
        resourceType: resourceTypeSchema
          .optional()
          .describe("Type of resource to create (namespace, configmap, deployment, service, etc.)"),

        // Common parameters for most resource types
        name: optionalNameSchema.describe("Name of the resource to create"),
        namespace: namespaceSchema,

        // ConfigMap specific parameters
        fromLiteral: z
          .array(z.string())
          .optional()
          .describe('Key-value pair for creating configmap (e.g. ["key1=value1", "key2=value2"])'),
        fromFile: z
          .array(z.string())
          .optional()
          .describe(
            'Path to file for creating configmap/secret (e.g. ["key1=/path/to/file1", "key2=/path/to/file2"]). The path is read on the machine running the MCP server, so it is rejected when the server runs over a remote (SSE/Streamable HTTP) transport; use "fromFileContent" to pass file contents directly instead.',
          ),
        fromFileContent: z
          .array(
            z.object({
              key: z.string().describe("Key to store the content under in the configmap/secret"),
              content: z.string().describe("The file content to store"),
            }),
          )
          .optional()
          .describe(
            'Inline file contents for creating a configmap/secret, provided by the client instead of a server-side path (e.g. [{"key": "app.conf", "content": "..."}]). Safe on all transports; use this instead of "fromFile" on remote (SSE/Streamable HTTP) servers.',
          ),

        // Secret specific parameters
        secretType: z
          .enum(["generic", "docker-registry", "tls"])
          .optional()
          .describe("Type of secret to create (generic, docker-registry, tls)"),

        // Service specific parameters
        serviceType: z
          .enum(["clusterip", "nodeport", "loadbalancer", "externalname"])
          .optional()
          .describe("Type of service to create (clusterip, nodeport, loadbalancer, externalname)"),
        tcpPort: z
          .array(z.string())
          .optional()
          .describe('Port pairs for tcp service (e.g. ["80:8080", "443:8443"])'),

        // Deployment specific parameters
        image: z.string().optional().describe("Image to use for the containers in the deployment"),
        replicas: z
          .number()
          .default(1)
          .optional()
          .describe("Number of replicas to create for the deployment"),
        port: z.number().optional().describe("Port that the container exposes"),

        // CronJob specific parameters
        schedule: z
          .string()
          .optional()
          .describe('Cron schedule expression for the CronJob (e.g. "*/5 * * * *")'),
        suspend: z.boolean().default(false).optional().describe("Whether to suspend the CronJob"),

        // Job specific parameters
        command: z.array(z.string()).optional().describe("Command to run in the container"),

        // Additional common parameters
        labels: z
          .array(z.string())
          .optional()
          .describe('Labels to apply to the resource (e.g. ["key1=value1", "key2=value2"])'),
        annotations: z
          .array(z.string())
          .optional()
          .describe('Annotations to apply to the resource (e.g. ["key1=value1", "key2=value2"])'),
        context: contextSchema,
      },
    },
    async (args) => runTool("kubectl_create", async () => formatCreate(await create(deps, args))),
  );

  return ["kubectl_create"];
}
