/**
 * kubectl_describe — describe a resource by type, name and optionally
 * namespace/context, or across all namespaces.
 *
 * Ported from src/tools/kubectl-describe.ts. The old tool special-cased a
 * "not found" stderr message into a JSON { error, status: "not_found" }
 * content block instead of throwing. deps.kubectl already normalizes that
 * same stderr pattern into a KubectlError with code "not_found" (see
 * core/errors.ts classify()), so that case is left to propagate and be
 * formatted uniformly by runTool, like every other converted tool.
 */
import { assertNotFlagLike } from "../security/argv.js";
import type { Deps } from "../types.js";

export interface DescribeArgs {
  resourceType: string;
  name: string;
  namespace?: string;
  allNamespaces?: boolean;
  context?: string;
}

export interface DescribeResult {
  raw: string;
}

// Resource kinds kubectl treats as cluster-scoped — passing -n/--namespace
// for these is either ignored or rejected depending on kubectl version, so
// the namespace flag is only added for namespaced resource types.
const NON_NAMESPACED_RESOURCES = new Set([
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
]);

function isNonNamespacedResource(resourceType: string): boolean {
  return NON_NAMESPACED_RESOURCES.has(resourceType.toLowerCase());
}

export async function describe(deps: Deps, args: DescribeArgs): Promise<DescribeResult> {
  // A resource type or name is an RFC 1123 name, never a flag. Refusing a
  // leading "-" closes the positional injection slot itself rather than
  // relying on the argv denylist to know every dangerous flag.
  assertNotFlagLike(args.resourceType, "resourceType");
  assertNotFlagLike(args.name, "name");

  const resourceType = args.resourceType.toLowerCase();
  const name = args.name;
  const namespace = args.namespace || "default";
  const allNamespaces = args.allNamespaces || false;

  const cmdArgs = ["describe", resourceType, name];

  if (allNamespaces) {
    cmdArgs.push("--all-namespaces");
  } else if (namespace && !isNonNamespacedResource(resourceType)) {
    cmdArgs.push("-n", namespace);
  }

  if (args.context) {
    cmdArgs.push("--context", args.context);
  }

  const raw = await deps.kubectl(cmdArgs, "kubectl_describe");
  return { raw };
}
