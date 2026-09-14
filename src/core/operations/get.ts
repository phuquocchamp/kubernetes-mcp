/**
 * kubectl_get operation — ported from src/tools/kubectl-get.ts.
 *
 * Builds the `kubectl get` argv, runs it through deps.kubectl (which
 * applies the argv guards and normalizes errors), applies secret masking,
 * and returns a typed result. Output shaping into the list/events summary
 * shapes happens in core/format/get.ts, exactly matching the JSON the old
 * tool returned as content[0].text.
 */

import { assertNotFlagLike } from "../security/argv.js";
import { maskSecretsData, resourceReferencesSecret } from "../security/secrets.js";
import type { Deps } from "../types.js";

export interface GetArgs {
  resourceType: string;
  name?: string;
  namespace?: string;
  output?: string;
  allNamespaces?: boolean;
  labelSelector?: string;
  fieldSelector?: string;
  sortBy?: string;
  context?: string;
}

export interface GetResult {
  resourceType: string;
  name: string;
  output: string;
  /** Raw (possibly secret-masked) kubectl output. */
  raw: string;
  /** True when no specific name was requested (list operation). */
  isListOperation: boolean;
}

// Helper function to determine if a resource is non-namespaced
function isNonNamespacedResource(resourceType: string): boolean {
  const nonNamespacedResources = [
    "nodes",
    "node",
    "no",
    "namespaces",
    "namespace",
    "ns",
    "persistentvolumes",
    "pv",
    "storageclasses",
    "sc",
    "clusterroles",
    "clusterrolebindings",
    "customresourcedefinitions",
    "crd",
    "crds",
  ];

  return nonNamespacedResources.includes(resourceType.toLowerCase());
}

// Compute pod status the same way kubectl does, by inspecting container statuses
// Based on kubernetes/pkg/printers/internalversion/printers.go printPod()
// biome-ignore lint/suspicious/noExplicitAny: mirrors raw kubectl JSON shape
function getPodStatus(pod: any): string {
  let reason = pod.status?.phase || "Unknown";

  if (pod.status?.reason) {
    reason = pod.status.reason;
  }

  // Check init container statuses
  const initContainerStatuses = pod.status?.initContainerStatuses || [];
  for (let i = 0; i < initContainerStatuses.length; i++) {
    const container = initContainerStatuses[i];
    const terminated = container.state?.terminated;
    const waiting = container.state?.waiting;

    if (terminated && terminated.exitCode === 0) {
      // Init container completed successfully, continue
      continue;
    }

    if (terminated) {
      if (terminated.reason) {
        reason = `Init:${terminated.reason}`;
      } else if (terminated.signal) {
        reason = `Init:Signal:${terminated.signal}`;
      } else {
        reason = `Init:ExitCode:${terminated.exitCode}`;
      }
    } else if (waiting && waiting.reason && waiting.reason !== "PodInitializing") {
      reason = `Init:${waiting.reason}`;
    } else {
      const totalInit = initContainerStatuses.length;
      reason = `Init:${i}/${totalInit}`;
    }
    break;
  }

  // If all init containers are done, check regular container statuses
  if (initContainerStatuses.length === 0 || !reason.startsWith("Init:")) {
    const containerStatuses = pod.status?.containerStatuses || [];
    let hasRunning = false;

    for (let i = containerStatuses.length - 1; i >= 0; i--) {
      const container = containerStatuses[i];
      const waiting = container.state?.waiting;
      const terminated = container.state?.terminated;

      if (waiting && waiting.reason) {
        reason = waiting.reason;
      } else if (terminated) {
        if (terminated.reason) {
          reason = terminated.reason;
        } else if (terminated.signal) {
          reason = `Signal:${terminated.signal}`;
        } else {
          reason = `ExitCode:${terminated.exitCode}`;
        }
      } else if (container.ready && container.state?.running) {
        hasRunning = true;
      }
    }

    // If all containers are ready and running, use the phase
    if (hasRunning && reason === (pod.status?.phase || "Unknown")) {
      reason = pod.status?.phase || "Running";
    }
  }

  // Handle pod deletion
  if (pod.metadata?.deletionTimestamp) {
    reason = "Terminating";
  }

  return reason;
}

// Extract status from various resource types
// biome-ignore lint/suspicious/noExplicitAny: mirrors raw kubectl JSON shape
export function getResourceStatus(resource: any, resourceType?: string): string {
  if (!resource) return "Unknown";

  const isPod =
    resource.kind === "Pod" ||
    resourceType === "pods" ||
    resourceType === "pod" ||
    resourceType === "po" ||
    (resource.status?.phase !== undefined && resource.status?.containerStatuses !== undefined);

  // Pod status - use kubectl-equivalent logic
  if (isPod) {
    return getPodStatus(resource);
  }

  // Deployment, ReplicaSet, StatefulSet status
  if (resource.status?.readyReplicas !== undefined) {
    const ready = resource.status.readyReplicas || 0;
    const total = resource.status.replicas || 0;
    return `${ready}/${total} ready`;
  }

  // Service status
  if (resource.spec?.type) {
    return resource.spec.type;
  }

  // Node status
  if (resource.status?.conditions) {
    // biome-ignore lint/suspicious/noExplicitAny: mirrors raw kubectl JSON shape
    const readyCondition = resource.status.conditions.find((c: any) => c.type === "Ready");
    if (readyCondition) {
      return readyCondition.status === "True" ? "Ready" : "NotReady";
    }
  }

  // Job/CronJob status
  if (resource.status?.succeeded !== undefined) {
    return resource.status.succeeded ? "Completed" : "Running";
  }

  // PV/PVC status
  if (resource.status?.phase) {
    return resource.status.phase;
  }

  return "Active";
}

export async function get(deps: Deps, args: GetArgs): Promise<GetResult> {
  // A resource type or name is an RFC 1123 name, never a flag. Refusing a
  // leading "-" closes the positional injection slot itself rather than
  // relying on the argv denylist to know every dangerous flag.
  assertNotFlagLike(args.resourceType, "resourceType");
  assertNotFlagLike(args.name, "name");

  const resourceType = args.resourceType.toLowerCase();
  const name = args.name || "";
  const namespace = args.namespace || "default";
  const output = args.output || "json";
  const allNamespaces = args.allNamespaces || false;
  const labelSelector = args.labelSelector || "";
  const fieldSelector = args.fieldSelector || "";
  const sortBy = args.sortBy;
  const context = args.context || "";

  const cmdArgs = ["get", resourceType];

  if (name) {
    cmdArgs.push(name);
  }

  // For events, default to all namespaces unless explicitly specified
  const shouldShowAllNamespaces = resourceType === "events" ? !args.namespace : allNamespaces;

  if (shouldShowAllNamespaces) {
    cmdArgs.push("--all-namespaces");
  } else if (namespace && !isNonNamespacedResource(resourceType)) {
    cmdArgs.push("-n", namespace);
  }

  if (context) {
    cmdArgs.push("--context", context);
  }

  if (labelSelector) {
    cmdArgs.push("-l", labelSelector);
  }

  if (fieldSelector) {
    cmdArgs.push(`--field-selector=${fieldSelector}`);
  }

  if (resourceType === "events" && sortBy) {
    cmdArgs.push(`--sort-by=.${sortBy}`);
  } else if (resourceType === "events") {
    cmdArgs.push(`--sort-by=.lastTimestamp`);
  }

  if (output === "json") {
    cmdArgs.push("-o", "json");
  } else if (output === "yaml") {
    cmdArgs.push("-o", "yaml");
  } else if (output === "wide") {
    cmdArgs.push("-o", "wide");
  } else if (output === "name") {
    cmdArgs.push("-o", "name");
  } else if (output === "custom") {
    if (resourceType === "events") {
      cmdArgs.push(
        "-o",
        "custom-columns=LASTSEEN:.lastTimestamp,TYPE:.type,REASON:.reason,OBJECT:.involvedObject.name,MESSAGE:.message",
      );
    } else {
      cmdArgs.push(
        "-o",
        "custom-columns=NAME:.metadata.name,NAMESPACE:.metadata.namespace,STATUS:.status.phase,AGE:.metadata.creationTimestamp",
      );
    }
  }

  const raw = await deps.kubectl(cmdArgs, "kubectl_get");

  // Apply secrets masking if enabled and dealing with secrets.
  // resourceReferencesSecret normalizes combined forms like
  // "secret/my-secret", group-qualified "secrets.v1./my-secret", and
  // comma-separated lists ("secret,configmap") so the masking decision
  // cannot be bypassed by addressing a Secret through an alternate syntax.
  const shouldMaskSecrets = deps.config.maskSecrets && resourceReferencesSecret(resourceType);

  const processedResult = shouldMaskSecrets ? maskSecretsData(raw, output) : raw;

  return {
    resourceType,
    name,
    output,
    raw: processedResult,
    isListOperation: !name,
  };
}
