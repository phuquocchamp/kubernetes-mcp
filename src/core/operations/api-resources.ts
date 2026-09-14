/**
 * list_api_resources — `kubectl api-resources`.
 */
import type { Deps } from "../types.js";

export interface ApiResourcesArgs {
  apiGroup?: string;
  namespaced?: boolean;
  verbs?: string[];
  output?: "wide" | "name" | "no-headers";
  context?: string;
}

export interface ApiResourcesResult {
  raw: string;
}

export async function listApiResources(
  deps: Deps,
  args: ApiResourcesArgs,
): Promise<ApiResourcesResult> {
  const cmdArgs = ["api-resources"];

  if (args.apiGroup) cmdArgs.push(`--api-group=${args.apiGroup}`);
  if (args.namespaced !== undefined) cmdArgs.push(`--namespaced=${args.namespaced}`);
  if (args.verbs && args.verbs.length > 0) cmdArgs.push(`--verbs=${args.verbs.join(",")}`);
  if (args.output) cmdArgs.push("-o", args.output);
  if (args.context) cmdArgs.push("--context", args.context);

  const raw = await deps.kubectl(cmdArgs, "list_api_resources");
  return { raw };
}
