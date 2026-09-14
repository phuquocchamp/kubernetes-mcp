/**
 * exec_in_pod — run a command inside a pod/container via `kubectl exec`.
 *
 * Ported from src/tools/exec_in_pod.ts. Command must be an array of strings
 * (enforced by the tool's zod inputSchema — array items are strings — and
 * checked again here as defense in depth); this rules out shell
 * interpretation the same way the old execFileSyncSafe-based tool did.
 *
 * A non-zero exit from the command running INSIDE the pod is a normal
 * outcome of running commands, not an internal tool failure — a diagnostic
 * command that prints useful output and then exits 1 should not have that
 * output discarded. core/errors.ts's normalizeError() attaches the raw
 * stdout/stderr/exitCode to the thrown KubectlError precisely for this
 * case (added during integration — the original conversion pass flagged
 * this as a regression because core/kubectl.ts was off-limits to it); this
 * operation catches that specific shape and returns the combined text as a
 * normal result, matching the original execFileSync-based tool exactly. A
 * genuine spawn/connection/timeout failure has no exitCode and still
 * propagates as an error.
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

  try {
    const output = await deps.kubectl(cmdArgs, "exec_in_pod", { timeoutMs });
    return { output };
  } catch (err) {
    if (err instanceof KubectlError && typeof err.exitCode === "number") {
      const output =
        `Command exited with code ${err.exitCode}\n` +
        (err.stdout ? `--- stdout ---\n${err.stdout}\n` : "") +
        (err.stderr ? `--- stderr ---\n${err.stderr}` : "");
      return { output };
    }
    throw err;
  }
}
