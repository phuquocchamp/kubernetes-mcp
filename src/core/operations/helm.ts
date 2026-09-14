/**
 * Helm chart operations: install_helm_chart, upgrade_helm_chart,
 * uninstall_helm_chart.
 *
 * Ported from src/tools/helm-operations.ts. Two install paths are
 * preserved: standard `helm install` and template mode (`helm template` |
 * `kubectl apply`), which bypasses auth/kubeconfig API-version mismatches
 * some clusters hit with a direct `helm install`.
 */
import { unlinkSync, writeFileSync } from "node:fs";
import { dump } from "js-yaml";
import { isRemoteTransport } from "../../security/transport.js";
import { KubectlError } from "../errors.js";
import { assertNotFlagLike } from "../security/argv.js";
import type { Deps } from "../types.js";

// helm install/upgrade/template can take a while against a slow cluster or
// large chart; the legacy execFileSyncSafe call site used a 5 minute
// timeout, so keep that instead of core/kubectl.ts's 60s default.
const HELM_TIMEOUT_MS = 300_000;

export interface InstallHelmChartArgs {
  name: string;
  chart: string;
  /** Optional; defaults to "default" (this group uses the shared `namespaceSchema`). */
  namespace?: string;
  /** Accepted for schema parity with the legacy tool; unused (see note below). */
  context?: string;
  repo?: string;
  values?: Record<string, unknown>;
  valuesFile?: string;
  useTemplate?: boolean;
  createNamespace?: boolean;
}

export interface UpgradeHelmChartArgs {
  name: string;
  chart: string;
  /** Optional; defaults to "default" (this group uses the shared `namespaceSchema`). */
  namespace?: string;
  /** Accepted for schema parity with the legacy tool; unused (see note below). */
  context?: string;
  repo?: string;
  values?: Record<string, unknown>;
  valuesFile?: string;
}

export interface UninstallHelmChartArgs {
  name: string;
  /** Optional; defaults to "default" (this group uses the shared `namespaceSchema`). */
  namespace?: string;
  /** Accepted for schema parity with the legacy tool; unused (see note below). */
  context?: string;
}

export interface InstallHelmResult {
  status: "installed";
  message: string;
  steps?: string[];
}

export interface UpgradeHelmResult {
  status: "upgraded";
  message: string;
}

export interface UninstallHelmResult {
  status: "uninstalled";
  message: string;
}

// Reject server-side filesystem reads on remote transports. Over SSE /
// Streamable HTTP the path resolves on the MCP server host, not the client,
// so `valuesFile` (-f) would let any client that can reach the endpoint read
// arbitrary server files (kubeconfig, service-account token,
// /proc/self/environ, etc.) via helm's parse errors. Clients on these
// transports must pass values inline via `values` instead.
function rejectValuesFileOnRemoteTransport(valuesFile: string | undefined, operation: string): void {
  if (valuesFile && isRemoteTransport()) {
    throw new KubectlError(
      "The 'valuesFile' parameter reads a file from the MCP server's filesystem and is disabled on remote (SSE/Streamable HTTP) transports. Pass the values inline via 'values' instead.",
      operation,
      "invalid_input",
    );
  }
}

// The release name, chart reference, namespace and repo URL are all placed
// in positional argv slots ("helm install <name> <chart>", "helm repo add
// <name> <url>", "kubectl create namespace <ns>"). pflag parses any token
// beginning with "-" as a flag regardless of position, so a caller-supplied
// value such as "--post-renderer=/tmp/x.sh" would become a helm flag
// instead of an operand. Reject flag-shaped operands up front rather than
// relying on the argv deny-list to know every dangerous helm flag.
function assertOperandsNotFlagLike(params: {
  name: string;
  chart?: string;
  namespace: string;
  repo?: string;
}): void {
  assertNotFlagLike(params.name, "release name");
  assertNotFlagLike(params.chart, "chart");
  assertNotFlagLike(params.namespace, "namespace");
  assertNotFlagLike(params.repo, "repo");
}

function writeValuesTempFile(values: Record<string, unknown>): string {
  const tempFile = `/tmp/values-${Date.now()}-${Math.random().toString(36).slice(2)}.yaml`;
  writeFileSync(tempFile, dump(values));
  return tempFile;
}

/**
 * Install a Helm chart using template mode (helm template + kubectl
 * apply). This mode bypasses authentication issues and kubeconfig API
 * version mismatches.
 */
async function installHelmChartTemplate(deps: Deps, args: InstallHelmChartArgs): Promise<InstallHelmResult> {
  const namespace = args.namespace ?? "default";
  const steps: string[] = [];

  if (args.repo) {
    steps.push(`Adding helm repository: ${args.repo}`);
    await deps.helm(["repo", "add", "temp-repo", args.repo], "install_helm_chart", { timeoutMs: HELM_TIMEOUT_MS });
    await deps.helm(["repo", "update"], "install_helm_chart", { timeoutMs: HELM_TIMEOUT_MS });
  }

  // Best-effort namespace creation: the legacy code inspected the raw error
  // message for "already exists" and re-threw anything else. deps.kubectl
  // normalizes errors (core/errors.ts) and no longer exposes that raw text,
  // so instead we treat namespace creation as best-effort here — a real
  // permission/connectivity problem still surfaces clearly from the
  // `kubectl apply` step below.
  steps.push(`Creating namespace: ${namespace}`);
  try {
    await deps.kubectl(["create", "namespace", namespace], "install_helm_chart");
  } catch {
    steps.push(`Namespace ${namespace} already exists or could not be created`);
  }

  steps.push("Generating YAML using helm template");
  const templateArgs = ["template", args.name, args.chart, "--namespace", namespace];
  if (args.repo) templateArgs.push("--repo", args.repo);

  let tempValuesFile: string | undefined;
  if (args.valuesFile) {
    // Hand the path to helm directly rather than reading the file's
    // contents into this process.
    steps.push(`Using values file: ${args.valuesFile}`);
    templateArgs.push("-f", args.valuesFile);
  } else if (args.values) {
    steps.push("Using provided values object");
    tempValuesFile = writeValuesTempFile(args.values);
    templateArgs.push("-f", tempValuesFile);
  }

  let yamlOutput: string;
  try {
    yamlOutput = await deps.helm(templateArgs, "install_helm_chart", { timeoutMs: HELM_TIMEOUT_MS });
  } finally {
    if (tempValuesFile) unlinkSync(tempValuesFile);
  }

  steps.push("Applying YAML using kubectl");
  const tempYamlFile = `/tmp/helm-template-${Date.now()}-${Math.random().toString(36).slice(2)}.yaml`;
  writeFileSync(tempYamlFile, yamlOutput);
  try {
    await deps.kubectl(["apply", "-f", tempYamlFile], "install_helm_chart");
  } finally {
    unlinkSync(tempYamlFile);
  }
  steps.push("Helm chart installed successfully using template mode");

  return {
    status: "installed",
    message: `Helm chart '${args.name}' installed successfully using template mode`,
    steps,
  };
}

/** Install a Helm chart, either via standard `helm install` or template mode. */
export async function installHelmChart(deps: Deps, args: InstallHelmChartArgs): Promise<InstallHelmResult> {
  const namespace = args.namespace ?? "default";
  rejectValuesFileOnRemoteTransport(args.valuesFile, "install_helm_chart");
  assertOperandsNotFlagLike({ ...args, namespace });

  if (args.useTemplate) {
    return installHelmChartTemplate(deps, { ...args, namespace });
  }

  if (args.repo) {
    const repoName = args.chart.split("/")[0];
    await deps.helm(["repo", "add", repoName, args.repo], "install_helm_chart", { timeoutMs: HELM_TIMEOUT_MS });
    await deps.helm(["repo", "update"], "install_helm_chart", { timeoutMs: HELM_TIMEOUT_MS });
  }

  const cmdArgs = ["install", args.name, args.chart, "--namespace", namespace];
  if (args.createNamespace !== false) {
    cmdArgs.push("--create-namespace");
  }

  let tempFile: string | undefined;
  try {
    if (args.valuesFile) {
      cmdArgs.push("-f", args.valuesFile);
    } else if (args.values) {
      tempFile = writeValuesTempFile(args.values);
      cmdArgs.push("-f", tempFile);
    }
    await deps.helm(cmdArgs, "install_helm_chart", { timeoutMs: HELM_TIMEOUT_MS });
  } finally {
    if (tempFile) unlinkSync(tempFile);
  }

  return {
    status: "installed",
    message: `Helm chart '${args.name}' installed successfully in namespace '${namespace}'`,
  };
}

/** Upgrade an existing Helm chart release. */
export async function upgradeHelmChart(deps: Deps, args: UpgradeHelmChartArgs): Promise<UpgradeHelmResult> {
  const namespace = args.namespace ?? "default";
  rejectValuesFileOnRemoteTransport(args.valuesFile, "upgrade_helm_chart");
  assertOperandsNotFlagLike({ ...args, namespace });

  if (args.repo) {
    const repoName = args.chart.split("/")[0];
    await deps.helm(["repo", "add", repoName, args.repo], "upgrade_helm_chart", { timeoutMs: HELM_TIMEOUT_MS });
    await deps.helm(["repo", "update"], "upgrade_helm_chart", { timeoutMs: HELM_TIMEOUT_MS });
  }

  const cmdArgs = ["upgrade", args.name, args.chart, "--namespace", namespace];

  let tempFile: string | undefined;
  try {
    if (args.valuesFile) {
      cmdArgs.push("-f", args.valuesFile);
    } else if (args.values) {
      tempFile = writeValuesTempFile(args.values);
      cmdArgs.push("-f", tempFile);
    }
    await deps.helm(cmdArgs, "upgrade_helm_chart", { timeoutMs: HELM_TIMEOUT_MS });
  } finally {
    if (tempFile) unlinkSync(tempFile);
  }

  return {
    status: "upgraded",
    message: `Helm chart '${args.name}' upgraded successfully in namespace '${namespace}'`,
  };
}

/** Uninstall a Helm chart release. */
export async function uninstallHelmChart(deps: Deps, args: UninstallHelmChartArgs): Promise<UninstallHelmResult> {
  const namespace = args.namespace ?? "default";
  assertNotFlagLike(args.name, "release name");
  assertNotFlagLike(namespace, "namespace");

  await deps.helm(["uninstall", args.name, "--namespace", namespace], "uninstall_helm_chart", {
    timeoutMs: HELM_TIMEOUT_MS,
  });

  return {
    status: "uninstalled",
    message: `Helm chart '${args.name}' uninstalled successfully from namespace '${namespace}'`,
  };
}
