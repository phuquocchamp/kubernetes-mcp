/**
 * kubectl_apply — applies a manifest given inline or via a server-side file
 * path. Mirrors the legacy src/tools/kubectl-apply.ts behavior: an inline
 * `manifest` is written to a temp file (kubectl apply needs a path, not
 * stdin, through this runner) and cleaned up afterward; a `filename` path is
 * rejected on remote transports since it would let a remote client read
 * arbitrary files on the MCP server host.
 */
import { promises as fsp } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { isRemoteTransport } from "../../security/transport.js";
import { KubectlError } from "../errors.js";
import type { Deps } from "../types.js";

export interface ApplyArgs {
  manifest?: string;
  filename?: string;
  namespace?: string;
  dryRun?: boolean;
  force?: boolean;
  context?: string;
}

export interface ApplyResult {
  raw: string;
}

export async function apply(deps: Deps, args: ApplyArgs): Promise<ApplyResult> {
  if (!args.manifest && !args.filename) {
    throw new KubectlError(
      "Either manifest or filename must be provided",
      "kubectl_apply",
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
      "kubectl_apply",
      "invalid_input",
    );
  }

  const namespace = args.namespace || "default";
  const cmdArgs = ["apply"];
  let tempFile: string | null = null;

  if (args.manifest) {
    tempFile = path.join(os.tmpdir(), `manifest-${Date.now()}.yaml`);
    await fsp.writeFile(tempFile, args.manifest);
    cmdArgs.push("-f", tempFile);
  } else if (args.filename) {
    cmdArgs.push("-f", args.filename);
  }

  cmdArgs.push("-n", namespace);
  if (args.dryRun) cmdArgs.push("--dry-run=client");
  if (args.force) cmdArgs.push("--force");
  if (args.context) cmdArgs.push("--context", args.context);

  try {
    const raw = await deps.kubectl(cmdArgs, "kubectl_apply");
    return { raw };
  } finally {
    if (tempFile) {
      try {
        await fsp.unlink(tempFile);
      } catch {
        // best-effort cleanup, mirrors the legacy console.warn-and-continue behavior
      }
    }
  }
}
