/**
 * MCP server factory.
 *
 * Wires all 10 tool registrars behind one gate: a tool a filtering mode
 * forbids is never registered at all — it never appears in tools/list, and
 * there is nothing for the call handler to refuse — rather than being
 * registered and then rejected at call time as the old dispatcher did
 * (jenkins-mcp's SAFE-03 pattern; closes finding S3 from the pre-refactor
 * analysis). `toolNames()` is derived from the same registration path a
 * real server uses, driven against a throwaway server and stub deps, so the
 * structural safety test can assert it without a cluster or a real process.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { serverConfig } from "./config/server-config.js";
import type { Config } from "./core/config.js";
import { runHelm, runKubectl } from "./core/kubectl.js";
import type { Deps } from "./core/types.js";
import { registerPromptHandlers } from "./prompts/index.js";
import { getResourceHandlers } from "./resources/handlers.js";
import { registerContextTools } from "./tools/context.js";
import { registerCreateTools } from "./tools/create.js";
import { registerDeleteTools } from "./tools/delete.js";
import { registerGetTools } from "./tools/get.js";
import { registerHelmTools } from "./tools/helm.js";
import { registerLogsTools } from "./tools/logs.js";
import { registerMiscTools } from "./tools/misc.js";
import { registerNodeTools } from "./tools/node.js";
import { registerWorkloadTools } from "./tools/workload.js";
import { registerWriteTools } from "./tools/write.js";
import { KubernetesManager } from "./types.js";

/** Every tool name this server can ever register, for ALLOWED_TOOLS validation. */
export const ALL_TOOL_NAMES = [
  "kubectl_get",
  "kubectl_describe",
  "kubectl_logs",
  "kubectl_context",
  "kubectl_reconnect",
  "explain_resource",
  "list_api_resources",
  "ping",
  "kubectl_apply",
  "kubectl_create",
  "kubectl_patch",
  "kubectl_scale",
  "kubectl_rollout",
  "install_helm_chart",
  "upgrade_helm_chart",
  "port_forward",
  "stop_port_forward",
  "exec_in_pod",
  "kubectl_delete",
  "uninstall_helm_chart",
  "cleanup",
  "kubectl_generic",
  "node_management",
] as const;

/** Same classification the old src/index.ts hand-maintained as three arrays. */
const READONLY_TOOL_NAMES = new Set([
  "kubectl_get",
  "kubectl_describe",
  "kubectl_logs",
  "kubectl_context",
  "kubectl_reconnect",
  "explain_resource",
  "list_api_resources",
  "ping",
]);

const DESTRUCTIVE_TOOL_NAMES = new Set([
  "kubectl_delete",
  "uninstall_helm_chart",
  "cleanup",
  "kubectl_generic",
  "node_management",
]);

export function isToolAllowed(name: string, config: Config): boolean {
  if (config.allowedToolNames) return config.allowedToolNames.includes(name);
  if (config.allowOnlyReadonlyTools) return READONLY_TOOL_NAMES.has(name);
  if (config.allowOnlyNonDestructiveTools) return !DESTRUCTIVE_TOOL_NAMES.has(name);
  return true;
}

/** Names in `config.allowedToolNames` that no tool actually provides — a misspelling must not fail open. */
export function findUnknownToolNames(config: Config): string[] {
  if (!config.allowedToolNames) return [];
  const known = new Set<string>(ALL_TOOL_NAMES);
  return config.allowedToolNames.filter((name) => !known.has(name)).sort();
}

function buildDeps(client: KubernetesManager, config: Config): Deps {
  return { kubectl: runKubectl, helm: runHelm, client, config };
}

/**
 * A registrar-facing McpServer view that silently skips registerTool for any
 * tool name the current mode forbids — every registrar in src/tools/*.ts
 * calls only `.registerTool(...)`, so intercepting that one method is
 * sufficient and requires no changes to any of the 10 converted files.
 */
function gatedServer(server: McpServer, config: Config): McpServer {
  return new Proxy(server, {
    get(target, prop, receiver) {
      if (prop === "registerTool") {
        return (name: string, def: unknown, handler: unknown) => {
          if (!isToolAllowed(name, config)) return undefined;
          return (target.registerTool as (...a: unknown[]) => unknown)(name, def, handler);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as McpServer;
}

const REGISTRARS = [
  registerGetTools,
  registerCreateTools,
  registerHelmTools,
  registerLogsTools,
  registerContextTools,
  registerNodeTools,
  registerDeleteTools,
  registerWriteTools,
  registerMiscTools,
  registerWorkloadTools,
];

export interface CreatedServer {
  server: McpServer;
  toolNames: string[];
  client: KubernetesManager;
}

export function createServer(config: Config): CreatedServer {
  const client = new KubernetesManager();
  const deps = buildDeps(client, config);
  const server = new McpServer(
    { name: serverConfig.name, version: serverConfig.version },
    { capabilities: { resources: {}, tools: {}, prompts: {} } },
  );
  const gated = gatedServer(server, config);

  const toolNames = REGISTRARS.flatMap((register) => register(gated, deps)).filter((name) =>
    isToolAllowed(name, config),
  );

  const resourceHandlers = getResourceHandlers(client);
  server.server.setRequestHandler(ListResourcesRequestSchema, resourceHandlers.listResources);
  server.server.setRequestHandler(ReadResourceRequestSchema, resourceHandlers.readResource);
  registerPromptHandlers(server.server, client);

  return { server, toolNames, client };
}

/**
 * The tool names a server in this mode would register, without building a
 * real server, a real KubernetesManager, or touching a cluster — driven
 * against a throwaway McpServer and stub deps. Used by the structural
 * safety test.
 */
export function toolNames(config: Config): string[] {
  const probe = new McpServer(
    { name: serverConfig.name, version: serverConfig.version },
    { capabilities: { tools: {} } },
  );
  const gated = gatedServer(probe, config);
  const stubDeps: Deps = {
    kubectl: async () => "",
    helm: async () => "",
    client: {} as KubernetesManager,
    config,
  };
  return REGISTRARS.flatMap((register) => register(gated, stubDeps)).filter((name) =>
    isToolAllowed(name, config),
  );
}
