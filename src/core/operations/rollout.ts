import { assertNotFlagLike } from "../security/argv.js";
import type { Deps } from "../types.js";

export interface RolloutArgs {
  subCommand: "history" | "pause" | "restart" | "resume" | "status" | "undo";
  resourceType: "deployment" | "daemonset" | "statefulset";
  name: string;
  namespace?: string;
  revision?: number;
  toRevision?: number;
  timeout?: string;
  watch?: boolean;
  context?: string;
}

export interface RolloutResult {
  raw: string;
  watchLimited: boolean;
}

const WATCH_TIMEOUT_MS = 15_000;

export async function rollout(deps: Deps, args: RolloutArgs): Promise<RolloutResult> {
  assertNotFlagLike(args.name, "name");

  const namespace = args.namespace ?? "default";
  const watch = args.watch ?? false;

  const cmdArgs = [
    "rollout",
    args.subCommand,
    `${args.resourceType}/${args.name}`,
    "-n",
    namespace,
  ];

  if (args.subCommand === "undo" && args.revision !== undefined) {
    cmdArgs.push(`--to-revision=${args.revision}`);
  }

  if (args.subCommand === "history" && args.toRevision !== undefined) {
    cmdArgs.push(`--revision=${args.toRevision}`);
  }

  if (args.timeout) cmdArgs.push(`--timeout=${args.timeout}`);
  if (args.context) cmdArgs.push("--context", args.context);

  // For status command with watch flag, we need to handle it differently
  // since it's meant to be interactive and follow the progress. We're
  // limited in what we can do here — execute it with a reasonable timeout
  // and capture the output until that point.
  if (args.subCommand === "status" && watch) {
    cmdArgs.push("--watch");
    const raw = await deps.kubectl(cmdArgs, "kubectl_rollout", { timeoutMs: WATCH_TIMEOUT_MS });
    return { raw, watchLimited: true };
  }

  const raw = await deps.kubectl(cmdArgs, "kubectl_rollout");
  return { raw, watchLimited: false };
}
