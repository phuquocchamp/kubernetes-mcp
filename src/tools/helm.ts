import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatInstallHelmChart, formatUninstallHelmChart, formatUpgradeHelmChart } from "../core/format/helm.js";
import { installHelmChart, uninstallHelmChart, upgradeHelmChart } from "../core/operations/helm.js";
import type { Deps } from "../core/types.js";
import { contextSchema, namespaceSchema, nameSchema } from "./schemas.js";
import { runTool } from "./result.js";

const chartSchema = z.string().min(1).describe("Chart name (e.g., 'nginx') or path to chart directory");

const repoSchema = z.string().optional().describe("Helm repository URL (optional if using local chart path)");

const valuesSchema = z.record(z.any()).optional().describe("Custom values to override chart defaults");

const valuesFileSchema = z
  .string()
  .optional()
  .describe(
    "Path to values file (alternative to values object). The path is read on the machine running the MCP server, so it is rejected when the server runs over a remote (SSE/Streamable HTTP) transport; use 'values' to pass the values inline instead.",
  );

export function registerHelmTools(server: McpServer, deps: Deps): string[] {
  server.registerTool(
    "install_helm_chart",
    {
      description: "Install a Helm chart with support for both standard and template-based installation",
      annotations: { destructiveHint: true },
      inputSchema: {
        name: nameSchema.describe("Name of the Helm release"),
        chart: chartSchema,
        namespace: namespaceSchema,
        context: contextSchema,
        repo: repoSchema,
        values: valuesSchema,
        valuesFile: valuesFileSchema,
        useTemplate: z
          .boolean()
          .optional()
          .default(false)
          .describe("Use helm template + kubectl apply instead of helm install (bypasses auth issues)"),
        createNamespace: z
          .boolean()
          .optional()
          .default(true)
          .describe("Create namespace if it doesn't exist"),
      },
    },
    async (args) =>
      runTool("install_helm_chart", async () => formatInstallHelmChart(await installHelmChart(deps, args))),
  );

  server.registerTool(
    "upgrade_helm_chart",
    {
      description: "Upgrade an existing Helm chart release",
      annotations: { destructiveHint: true },
      inputSchema: {
        name: nameSchema.describe("Name of the Helm release to upgrade"),
        chart: chartSchema,
        namespace: namespaceSchema,
        context: contextSchema,
        repo: repoSchema,
        values: valuesSchema,
        valuesFile: valuesFileSchema,
      },
    },
    async (args) =>
      runTool("upgrade_helm_chart", async () => formatUpgradeHelmChart(await upgradeHelmChart(deps, args))),
  );

  server.registerTool(
    "uninstall_helm_chart",
    {
      description: "Uninstall a Helm chart release",
      annotations: { destructiveHint: true },
      inputSchema: {
        name: nameSchema.describe("Name of the Helm release to uninstall"),
        namespace: namespaceSchema,
        context: contextSchema,
      },
    },
    async (args) =>
      runTool("uninstall_helm_chart", async () => formatUninstallHelmChart(await uninstallHelmChart(deps, args))),
  );

  return ["install_helm_chart", "upgrade_helm_chart", "uninstall_helm_chart"];
}
