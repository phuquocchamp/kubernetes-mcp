import { assertNotFlagLike } from "../security/argv.js";
import type { Deps } from "../types.js";

export interface ScaleArgs {
  name: string;
  namespace?: string;
  replicas: number;
  resourceType?: string;
  context?: string;
}

export interface ScaleResult {
  kind: string;
  name: string;
  namespace: string;
  replicas: number;
  raw: string;
}

export async function scale(deps: Deps, args: ScaleArgs): Promise<ScaleResult> {
  // A resource type or name is an RFC 1123 name, never a flag. Refusing a
  // leading "-" closes the positional injection slot itself rather than
  // relying on the argv denylist to know every dangerous flag.
  assertNotFlagLike(args.resourceType, "resourceType");
  assertNotFlagLike(args.name, "name");

  const resourceType = args.resourceType ?? "deployment";
  const namespace = args.namespace ?? "default";

  const cmdArgs = ["scale", resourceType, args.name, `--replicas=${args.replicas}`, `--namespace=${namespace}`];
  if (args.context) cmdArgs.push("--context", args.context);

  const raw = await deps.kubectl(cmdArgs, "kubectl_scale");
  return { kind: resourceType, name: args.name, namespace, replicas: args.replicas, raw };
}
