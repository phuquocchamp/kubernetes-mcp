import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { isRemoteTransport } from "../../security/transport.js";
import { KubectlError } from "../errors.js";
import type { Deps } from "../types.js";

export interface PatchArgs {
  resourceType: string;
  name: string;
  namespace?: string;
  patchType?: "strategic" | "merge" | "json";
  patchData?: object;
  patchFile?: string;
  dryRun?: boolean;
  context?: string;
}

export interface PatchResult {
  raw: string;
}

export async function patch(deps: Deps, args: PatchArgs): Promise<PatchResult> {
  if (!args.patchData && !args.patchFile) {
    throw new KubectlError(
      "Either patchData or patchFile must be provided",
      "kubectl_patch",
      "invalid_input",
    );
  }

  // Reject server-side filesystem reads on remote transports. Over SSE /
  // Streamable HTTP the path resolves on the MCP server host, not the
  // client, so `patchFile` (--patch-file) would let any client that can
  // reach the endpoint read arbitrary server files (kubeconfig,
  // service-account token, /proc/self/environ, etc.) via kubectl's parse
  // errors, or merge their contents into a resource that is then readable
  // through kubectl_get. Clients on these transports must pass the patch
  // inline via `patchData` instead.
  if (isRemoteTransport() && args.patchFile) {
    throw new KubectlError(
      "The 'patchFile' parameter reads a file from the MCP server's filesystem and is disabled on remote (SSE/Streamable HTTP) transports. Pass the patch contents via 'patchData' instead.",
      "kubectl_patch",
      "invalid_input",
    );
  }

  if (
    args.patchData !== undefined &&
    (args.patchData === null || typeof args.patchData !== "object")
  ) {
    throw new KubectlError(
      "patchData must be a valid JSON object, not a string.",
      "kubectl_patch",
      "invalid_input",
    );
  }

  const namespace = args.namespace ?? "default";
  const patchType = args.patchType ?? "strategic";

  const cmdArgs = ["patch", args.resourceType, args.name, "-n", namespace, "--type", patchType];

  let tempFile: string | null = null;
  if (args.patchData) {
    tempFile = path.join(os.tmpdir(), `patch-${Date.now()}.json`);
    fs.writeFileSync(tempFile, JSON.stringify(args.patchData));
    cmdArgs.push("--patch-file", tempFile);
  } else if (args.patchFile) {
    cmdArgs.push("--patch-file", args.patchFile);
  }

  if (args.dryRun) cmdArgs.push("--dry-run=client");
  if (args.context) cmdArgs.push("--context", args.context);

  try {
    const raw = await deps.kubectl(cmdArgs, "kubectl_patch");
    return { raw };
  } finally {
    if (tempFile) {
      try {
        fs.unlinkSync(tempFile);
      } catch (err) {
        console.error(`Failed to delete temporary file ${tempFile}: ${err}`);
      }
    }
  }
}
