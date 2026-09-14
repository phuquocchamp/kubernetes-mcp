/**
 * exec_in_pod — run a command inside a pod/container via `kubectl exec`.
 *
 * Ported from src/tools/exec_in_pod.ts. Command must be an array of strings
 * (enforced by the tool's zod inputSchema — array items are strings — and
 * checked again here as defense in depth); this rules out shell
 * interpretation the same way the old execFileSyncSafe-based tool did.
 *
 * SIMPLIFICATION vs the original: the old tool used execFileSync directly
 * and, on a non-zero exit from the command inside the pod, returned the
 * captured stdout + stderr + exit code as a normal (non-error) result
 * instead of throwing, so partial output from a command that printed
 * diagnostics and then exited 1 was not discarded. deps.kubectl
 * (core/kubectl.ts) always normalizes a failure into a KubectlError via
 * normalizeError() before it reaches this file, and that error carries
 * only a classified message derived from stderr — the child's stdout is
 * not threaded through. So a non-zero exit here now surfaces as a
 * KubectlError (formatted by runTool) rather than as captured stdout/stderr
 * text. Preserving the original behavior would require deps.kubectl itself
 * to expose raw stdout on failure, which is out of scope for this
 * operation file (core/kubectl.ts is explicitly not-to-touch). Flagged in
 * the final report for the integrator.
 */

import { KubectlError } from "../errors.js";
import { assertNotFlagLike } from "../security/argv.js";
import type { Deps } from "../types.js";

export interface ExecArgs {
  name: string;
  namespace?: string;
  command: string[];
  container?: string;
  timeout?: number;
  context?: string;
}

export interface ExecResult {
  output: string;
}

export async function execInPod(deps: Deps, args: ExecArgs): Promise<ExecResult> {
  assertNotFlagLike(args.name, "name");

  const namespace = args.namespace || "default";

  if (!Array.isArray(args.command)) {
    throw new KubectlError(
      'Command must be an array of strings (e.g. ["ls", "-la"]). String commands are not supported for security reasons.',
      "exec_in_pod",
      "invalid_input",
    );
  }

  if (args.command.length === 0) {
    throw new KubectlError("Command array cannot be empty", "exec_in_pod", "invalid_input");
  }

  for (let i = 0; i < args.command.length; i++) {
    if (typeof args.command[i] !== "string") {
      throw new KubectlError(
        `Command array element at index ${i} must be a string`,
        "exec_in_pod",
        "invalid_input",
      );
    }
  }

  const cmdArgs = ["exec", args.name, "-n", namespace];

  if (args.container) cmdArgs.push("-c", args.container);
  if (args.context) cmdArgs.push("--context", args.context);

  cmdArgs.push("--", ...args.command);

  const timeoutMs = args.timeout || 60000;

  const output = await deps.kubectl(cmdArgs, "exec_in_pod", { timeoutMs });
  return { output };
}
