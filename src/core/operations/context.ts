/**
 * kubectl_context / kubectl_reconnect operations.
 *
 * kubectl_context wraps `kubectl config get-contexts` / `current-context` /
 * `use-context`. kubectl_reconnect does NOT spawn kubectl at all — it
 * recreates the API clients on the live KubernetesManager (deps.client).
 */
import { getSpawnMaxBuffer } from "../../config/max-buffer.js";
import { KubectlError } from "../errors.js";
import { assertNotFlagLike } from "../security/argv.js";
import type { Deps } from "../types.js";

/** The legacy tool passed this on every spawn; core/kubectl.ts defaults to 10MB, so thread it through explicitly. */
const RUN_OPTS = { maxBuffer: getSpawnMaxBuffer() };

export interface ContextArgs {
  operation: "list" | "get" | "set";
  name?: string;
  showCurrent?: boolean;
  detailed?: boolean;
  output?: "json" | "yaml" | "name" | "custom";
}

export interface ContextEntry {
  name: string;
  cluster: string;
  user: string;
  namespace: string;
  isCurrent: boolean;
}

export type ContextResult =
  | { kind: "list-structured"; contexts: ContextEntry[] }
  | { kind: "list-raw"; raw: string }
  | { kind: "get-simple"; currentContext: string }
  | { kind: "get-detailed"; name: string; cluster: string; user: string; namespace: string }
  | { kind: "set"; success: true; message: string; context: string };

export interface ReconnectResult {
  success: true;
  message: string;
}

/** Parses the tabular `kubectl config get-contexts` output using column positions from the header. */
function parseContextsTable(raw: string): ContextEntry[] {
  const lines = raw.trim().split("\n");
  const headerLine = lines[0] ?? "";

  const currentPos = headerLine.indexOf("CURRENT");
  const namePos = headerLine.indexOf("NAME");
  const clusterPos = headerLine.indexOf("CLUSTER");
  const authInfoPos = headerLine.indexOf("AUTHINFO");
  const namespacePos = headerLine.indexOf("NAMESPACE");

  if (
    currentPos === -1 ||
    namePos === -1 ||
    clusterPos === -1 ||
    authInfoPos === -1 ||
    namespacePos === -1
  ) {
    throw new KubectlError("Invalid kubectl output format", "kubectl_context", "invalid_input");
  }

  const contexts: ContextEntry[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.trim() === "") continue;

    const isCurrent = line.substring(currentPos, namePos).trim() === "*";
    const name = line.substring(namePos, clusterPos).trim();
    const cluster = line.substring(clusterPos, authInfoPos).trim();
    const authInfo =
      namespacePos > 0
        ? line.substring(authInfoPos, namespacePos).trim()
        : line.substring(authInfoPos).trim();
    const namespace =
      namespacePos > 0 ? line.substring(namespacePos).trim() || "default" : "default";

    contexts.push({ name, cluster, user: authInfo, namespace, isCurrent });
  }

  return contexts;
}

async function contextList(deps: Deps, args: ContextArgs): Promise<ContextResult> {
  const output = args.output ?? "json";

  if (output === "custom" || output === "json") {
    const raw = await deps.kubectl(["config", "get-contexts"], "kubectl_context", RUN_OPTS);
    return { kind: "list-structured", contexts: parseContextsTable(raw) };
  }

  const listArgs = ["config", "get-contexts"];
  if (output === "name") listArgs.push("-o", "name");

  const raw = await deps.kubectl(listArgs, "kubectl_context", RUN_OPTS);
  return { kind: "list-raw", raw };
}

async function contextGet(deps: Deps, args: ContextArgs): Promise<ContextResult> {
  const detailed = args.detailed === true;
  const currentContext = (
    await deps.kubectl(["config", "current-context"], "kubectl_context", RUN_OPTS)
  ).trim();

  if (!detailed) {
    return { kind: "get-simple", currentContext };
  }

  const raw = await deps.kubectl(["config", "get-contexts"], "kubectl_context", RUN_OPTS);
  const lines = raw.trim().split("\n");
  const headers = (lines[0] ?? "").trim().split(/\s+/);
  const nameIndex = headers.indexOf("NAME");
  const clusterIndex = headers.indexOf("CLUSTER");
  const authInfoIndex = headers.indexOf("AUTHINFO");
  const namespaceIndex = headers.indexOf("NAMESPACE");

  let contextData = { name: currentContext, cluster: "", user: "", namespace: "default" };

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const columns = line.trim().split(/\s+/);
    const name = columns[nameIndex]?.trim();

    if (name === currentContext) {
      contextData = {
        name: currentContext,
        cluster: columns[clusterIndex]?.trim() || "",
        user: columns[authInfoIndex]?.trim() || "",
        namespace: columns[namespaceIndex]?.trim() || "default",
      };
      break;
    }
  }

  return { kind: "get-detailed", ...contextData };
}

async function contextSet(deps: Deps, args: ContextArgs): Promise<ContextResult> {
  const name = args.name;
  if (!name) {
    throw new KubectlError(
      "Name parameter is required for set operation",
      "kubectl_context",
      "invalid_input",
    );
  }
  assertNotFlagLike(name, "name");

  const rawList = await deps.kubectl(
    ["config", "get-contexts", "-o", "name"],
    "kubectl_context",
    RUN_OPTS,
  );
  const availableContexts = rawList.trim().split("\n");

  // Extract the short name from the ARN if needed (e.g. EKS-style "cluster/<name>" contexts).
  let contextName = name;
  if (name.includes("cluster/")) {
    const parts = name.split("cluster/");
    if (parts.length > 1 && parts[1]) contextName = parts[1];
  }

  if (!availableContexts.includes(contextName) && !availableContexts.includes(name)) {
    throw new KubectlError(`Context '${name}' not found`, "kubectl_context", "invalid_input");
  }

  await deps.kubectl(["config", "use-context", contextName], "kubectl_context", RUN_OPTS);

  return { kind: "set", success: true, message: `Current context set to '${name}'`, context: name };
}

export async function kubectlContext(deps: Deps, args: ContextArgs): Promise<ContextResult> {
  switch (args.operation) {
    case "list":
      return contextList(deps, args);
    case "get":
      return contextGet(deps, args);
    case "set":
      return contextSet(deps, args);
    default:
      throw new KubectlError(
        `Invalid operation: ${args.operation}`,
        "kubectl_context",
        "invalid_input",
      );
  }
}

/** Recreates the API clients on the live KubernetesManager. Does not spawn kubectl. */
export async function kubectlReconnect(deps: Deps): Promise<ReconnectResult> {
  try {
    deps.client.refreshApiClients();
  } catch (err) {
    throw new KubectlError(
      `Failed to reconnect: ${err instanceof Error ? err.message : String(err)}`,
      "kubectl_reconnect",
      "internal",
    );
  }

  return {
    success: true,
    message: "API clients refreshed. DNS will be re-resolved on the next request.",
  };
}
