/**
 * kubectl_delete — delete resources by type/name/selector or from a
 * manifest (inline or file). Ported from src/tools/kubectl-delete.ts.
 */
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { isRemoteTransport } from "../../security/transport.js";
import { KubectlError } from "../errors.js";
import { assertNotFlagLike } from "../security/argv.js";
import type { Deps } from "../types.js";

export interface DeleteArgs {
  resourceType?: string;
  name?: string;
  namespace?: string;
  labelSelector?: string;
  manifest?: string;
  filename?: string;
  allNamespaces?: boolean;
  force?: boolean;
  gracePeriodSeconds?: number;
  context?: string;
}

export interface DeleteResult {
  raw: string;
}

// Resource types that are cluster-scoped: passing -n/--namespace for these is
// a kubectl error, so the namespace flag is only added for namespaced types.
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

export async function deleteResource(deps: Deps, args: DeleteArgs): Promise<DeleteResult> {
  // Validate input - need at least one way to identify resources.
  if (!args.resourceType && !args.manifest && !args.filename) {
    throw new KubectlError(
      "Either resourceType, manifest, or filename must be provided",
      "kubectl_delete",
      "invalid_input",
    );
  }

  // If resourceType is provided, need either name or labelSelector.
  if (args.resourceType && !args.name && !args.labelSelector) {
    throw new KubectlError(
      "When using resourceType, either name or labelSelector must be provided",
      "kubectl_delete",
      "invalid_input",
    );
  }

  // Reject server-side filesystem reads on remote transports. Over SSE /
  // Streamable HTTP the path resolves on the MCP server host, not the
  // client, so `filename` (-f) would let any client that can reach the
  // endpoint read arbitrary server files (kubeconfig, service-account
  // token, /proc/self/environ, etc.) via kubectl's parse errors. Clients
  // on these transports must pass content inline via `manifest` instead.
  if (isRemoteTransport() && args.filename) {
    throw new KubectlError(
      "The 'filename' parameter reads a file from the MCP server's filesystem and is disabled on remote (SSE/Streamable HTTP) transports. Pass the file contents via 'manifest' instead.",
      "kubectl_delete",
      "invalid_input",
    );
  }

  const namespace = args.namespace || "default";
  const allNamespaces = args.allNamespaces || false;
  const force = args.force || false;
  const context = args.context || "";

  const cmdArgs: string[] = ["delete"];
  let tempFile: string | null = null;

  try {
    // Handle deleting from manifest or file.
    if (args.manifest) {
      tempFile = path.join(os.tmpdir(), `delete-manifest-${Date.now()}.yaml`);
      await fs.writeFile(tempFile, args.manifest);
      cmdArgs.push("-f", tempFile);
    } else if (args.filename) {
      cmdArgs.push("-f", args.filename);
    } else {
      // Handle deleting by resource type and name/selector.
      // A resource type or name is an RFC 1123 name, never a flag. Refusing
      // a leading "-" closes the positional injection slot itself rather than
      // relying on the argv denylist to know every dangerous flag.
      assertNotFlagLike(args.resourceType, "resourceType");
      assertNotFlagLike(args.name, "name");

      cmdArgs.push(args.resourceType as string);

      if (args.name) cmdArgs.push(args.name);
      if (args.labelSelector) cmdArgs.push("-l", args.labelSelector);
    }

    // Add namespace flags.
    if (allNamespaces) {
      cmdArgs.push("--all-namespaces");
    } else if (namespace && args.resourceType && !isNonNamespacedResource(args.resourceType)) {
      cmdArgs.push("-n", namespace);
    }

    // Add force flag if requested.
    if (force) cmdArgs.push("--force");

    // Add grace period if specified.
    if (args.gracePeriodSeconds !== undefined) {
      cmdArgs.push(`--grace-period=${args.gracePeriodSeconds}`);
    }

    // Add context if provided.
    if (context) cmdArgs.push("--context", context);

    const raw = await deps.kubectl(cmdArgs, "kubectl_delete");
    return { raw };
  } finally {
    if (tempFile) {
      try {
        await fs.unlink(tempFile);
      } catch {
        // Best-effort cleanup; a leftover temp file is not fatal.
      }
    }
  }
}
