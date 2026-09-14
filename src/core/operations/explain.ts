/**
 * explain_resource — `kubectl explain`. Pure argv building; no input
 * validation beyond what deps.kubectl's argv guards already do.
 */
import type { Deps } from "../types.js";

export interface ExplainArgs {
  resource: string;
  apiVersion?: string;
  recursive?: boolean;
  context?: string;
  output?: "plaintext" | "plaintext-openapiv2";
}

export interface ExplainResult {
  raw: string;
}

export async function explain(deps: Deps, args: ExplainArgs): Promise<ExplainResult> {
  const cmdArgs = ["explain"];

  if (args.apiVersion) cmdArgs.push(`--api-version=${args.apiVersion}`);
  if (args.recursive) cmdArgs.push("--recursive");
  if (args.context) cmdArgs.push("--context", args.context);
  if (args.output) cmdArgs.push(`--output=${args.output}`);
  cmdArgs.push(args.resource);

  const raw = await deps.kubectl(cmdArgs, "explain_resource");
  return { raw };
}
