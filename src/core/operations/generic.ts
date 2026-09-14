/**
 * kubectl_generic — execute an arbitrary kubectl command from structured
 * pieces (command/subCommand/resourceType/name/flags/args). The highest-risk
 * tool in this group: it hands the caller a free-form argv, so every argv
 * guard call from the original src/tools/kubectl-generic.ts is preserved
 * exactly, in the same order.
 */
import {
  assertNoDangerousFlags,
  assertNoRemoteFileReads,
  assertNotFlagLike,
} from "../security/argv.js";
import type { Deps } from "../types.js";

export interface GenericArgs {
  command: string;
  subCommand?: string;
  resourceType?: string;
  name?: string;
  namespace?: string;
  allNamespaces?: boolean;
  outputFormat?: string;
  flags?: Record<string, unknown>;
  args?: string[];
  context?: string;
}

export interface GenericResult {
  raw: string;
}

export async function generic(deps: Deps, args: GenericArgs): Promise<GenericResult> {
  // Reject credential/target-redirecting flags before constructing the
  // command. See src/security/kubectl-flags.ts for the rationale.
  assertNoDangerousFlags(args.flags, args.args);

  // The verb and the resource operands are never flags — only the free-form
  // `args` array is. Refusing a leading "-" in the operand slots closes the
  // positional injection point without narrowing what `args` can express.
  assertNotFlagLike(args.command, "command");
  assertNotFlagLike(args.subCommand, "subCommand");
  assertNotFlagLike(args.resourceType, "resourceType");
  assertNotFlagLike(args.name, "name");

  const cmdArgs: string[] = [args.command];

  // Add subcommand if provided.
  if (args.subCommand) cmdArgs.push(args.subCommand);

  // Add resource type if provided.
  if (args.resourceType) cmdArgs.push(args.resourceType);

  // Add resource name if provided.
  if (args.name) cmdArgs.push(args.name);

  // Add namespace scoping: --all-namespaces takes precedence over a
  // specific namespace (kubectl rejects using both together).
  if (args.allNamespaces) {
    cmdArgs.push("--all-namespaces");
  } else if (args.namespace) {
    cmdArgs.push(`--namespace=${args.namespace}`);
  }

  // Add output format if provided.
  if (args.outputFormat) cmdArgs.push(`-o=${args.outputFormat}`);

  // Add any provided flags.
  if (args.flags) {
    for (const [key, value] of Object.entries(args.flags)) {
      if (value === true) {
        // Handle boolean flags.
        cmdArgs.push(`--${key}`);
      } else if (value !== false && value !== null && value !== undefined) {
        // Skip false/null/undefined values, add others as --key=value.
        cmdArgs.push(`--${key}=${value}`);
      }
    }
  }

  // Add any additional arguments.
  if (args.args && args.args.length > 0) cmdArgs.push(...args.args);

  // Add context if provided.
  if (args.context) cmdArgs.push("--context", args.context);

  // Reject server-side filesystem reads on remote transports, matching the
  // per-parameter guards in the structured tools. This tool hands the caller
  // a free-form kubectl argv, so there is no parameter to attach them to:
  // "--from-file", "-f" and friends arrive as raw tokens and have to be
  // matched in the argv. See src/security/transport.ts for the trust model.
  // No-op under stdio, where the files are the operator's own.
  assertNoRemoteFileReads(cmdArgs);

  const raw = await deps.kubectl(cmdArgs, "kubectl_generic");
  return { raw };
}
