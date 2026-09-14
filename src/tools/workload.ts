import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatDescribe } from "../core/format/describe.js";
import { formatExec } from "../core/format/exec.js";
import { formatPortForward, formatStopPortForward } from "../core/format/port-forward.js";
import { describe } from "../core/operations/describe.js";
import { execInPod } from "../core/operations/exec.js";
import { portForward, stopPortForward } from "../core/operations/port-forward.js";
import type { Deps } from "../core/types.js";
import { runTool } from "./result.js";
import {
  allNamespacesSchema,
  contextSchema,
  nameSchema,
  namespaceSchema,
  resourceTypeSchema,
} from "./schemas.js";

export function registerWorkloadTools(server: McpServer, deps: Deps): string[] {
  server.registerTool(
    "kubectl_describe",
    {
      description: "Describe Kubernetes resources by resource type, name, and optionally namespace",
      annotations: {
        readOnlyHint: true,
      },
      inputSchema: {
        resourceType: resourceTypeSchema.describe(
          "Type of resource to describe (e.g., pods, deployments, services, etc.)",
        ),
        name: nameSchema.describe("Name of the resource to describe"),
        namespace: namespaceSchema,
        context: contextSchema,
        allNamespaces: allNamespacesSchema
          .default(false)
          .describe("If true, describe resources across all namespaces"),
      },
    },
    async (args) =>
      runTool("kubectl_describe", async () => formatDescribe(await describe(deps, args))),
  );

  server.registerTool(
    "port_forward",
    {
      description: "Forward a local port to a port on a Kubernetes resource",
      annotations: {
        title: "Port Forward",
      },
      inputSchema: {
        resourceType: resourceTypeSchema,
        resourceName: nameSchema.describe("Name of the resource to forward to"),
        localPort: z.number().describe("Local port to forward from"),
        targetPort: z.number().describe("Target port on the resource to forward to"),
        namespace: namespaceSchema,
      },
    },
    async (args) =>
      runTool("port_forward", async () => formatPortForward(await portForward(deps, args))),
  );

  server.registerTool(
    "stop_port_forward",
    {
      description: "Stop a port-forward process",
      annotations: {
        title: "Stop Port Forward",
      },
      inputSchema: {
        id: z.string().describe("The id of the port-forward to stop"),
      },
    },
    async (args) =>
      runTool("stop_port_forward", async () =>
        formatStopPortForward(await stopPortForward(deps, args)),
      ),
  );

  server.registerTool(
    "exec_in_pod",
    {
      description:
        "Execute a command in a Kubernetes pod or container and return the output. Command must be an array of strings where the first element is the executable and remaining elements are arguments. This executes directly without shell interpretation for security.",
      annotations: {
        destructiveHint: true,
      },
      inputSchema: {
        name: nameSchema.describe("Name of the pod to execute the command in"),
        namespace: namespaceSchema,
        command: z
          .array(z.string())
          .min(1)
          .describe(
            'Command to execute as an array of strings (e.g. ["ls", "-la", "/app"]). First element is the executable, remaining are arguments. Shell operators like pipes, redirects, or command chaining are not supported - use explicit array format for security.',
          ),
        container: z
          .string()
          .optional()
          .describe("Container name (required when pod has multiple containers)"),
        timeout: z
          .number()
          .optional()
          .describe("Timeout for command - 60000 milliseconds if not specified"),
        context: contextSchema,
      },
    },
    async (args) => runTool("exec_in_pod", async () => formatExec(await execInPod(deps, args))),
  );

  return ["kubectl_describe", "port_forward", "stop_port_forward", "exec_in_pod"];
}
