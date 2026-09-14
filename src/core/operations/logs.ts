/**
 * kubectl_logs — get logs from a pod, or from the pods behind a
 * deployment/job/cronjob/label selector.
 *
 * Ported from src/tools/kubectl-logs.ts. Per-pod failures when fanning out
 * over a label selector are captured into the per-pod logs map (matching
 * the old behavior) rather than failing the whole call; a failure on the
 * single-pod, deployment-selector-lookup, or cronjob-job-lookup path
 * propagates as a KubectlError (thrown by deps.kubectl) for runTool to
 * format.
 */
import { getSpawnMaxBuffer } from "../../config/max-buffer.js";
import { assertNotFlagLike } from "../security/argv.js";
import { KubectlError } from "../errors.js";
import type { Deps } from "../types.js";

export interface LogsArgs {
  resourceType: "pod" | "deployment" | "job" | "cronjob";
  name: string;
  namespace?: string;
  container?: string;
  tail?: number;
  since?: string;
  sinceTime?: string;
  timestamps?: boolean;
  previous?: boolean;
  follow?: boolean;
  labelSelector?: string;
  context?: string;
}

export type LogsResult =
  | { kind: "pod"; name: string; logs: string }
  | { kind: "message"; message: string }
  | { kind: "selector"; selector: string; namespace: string; logs: Record<string, string> }
  | { kind: "cronjob"; cronjob: string; namespace: string; jobs: Record<string, Record<string, string>> };

function addLogOptions(args: string[], input: LogsArgs): string[] {
  if (input.tail !== undefined) args.push(`--tail=${input.tail}`);
  if (input.since) args.push(`--since=${input.since}`);
  if (input.sinceTime) args.push(`--since-time=${input.sinceTime}`);
  if (input.timestamps) args.push("--timestamps");
  if (input.previous) args.push("--previous");
  if (input.follow) args.push("--follow");
  if (input.context) args.push("--context", input.context);
  return args;
}

async function getLabelSelectorLogs(
  deps: Deps,
  labelSelector: string,
  namespace: string,
  input: LogsArgs,
): Promise<LogsResult> {
  const podsArgs = ["-n", namespace, "get", "pods", `--selector=${labelSelector}`, "-o", "jsonpath={.items[*].metadata.name}"];
  const podsRaw = (await deps.kubectl(podsArgs, "kubectl_logs", { maxBuffer: getSpawnMaxBuffer() })).trim();
  const pods = podsRaw ? podsRaw.split(" ") : [];

  if (pods.length === 0 || (pods.length === 1 && pods[0] === "")) {
    return { kind: "message", message: `No pods found with label selector "${labelSelector}" in namespace ${namespace}` };
  }

  const logsMap: Record<string, string> = {};
  for (const pod of pods) {
    if (!pod) continue;
    let podArgs = ["-n", namespace, "logs", pod];
    if (input.container) podArgs.push("-c", input.container);
    podArgs = addLogOptions(podArgs, input);

    try {
      logsMap[pod] = await deps.kubectl(podArgs, "kubectl_logs", { maxBuffer: getSpawnMaxBuffer() });
    } catch (err) {
      logsMap[pod] = `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  return { kind: "selector", selector: labelSelector, namespace, logs: logsMap };
}

export async function logs(deps: Deps, args: LogsArgs): Promise<LogsResult> {
  assertNotFlagLike(args.name, "name");
  const resourceType = (args.resourceType ?? "pod").toLowerCase();
  const name = args.name;
  const namespace = args.namespace || "default";

  if (resourceType === "pod") {
    let podArgs = ["-n", namespace, "logs", name];
    if (args.container) podArgs.push("-c", args.container);
    podArgs = addLogOptions(podArgs, args);

    const raw = await deps.kubectl(podArgs, "kubectl_logs", { maxBuffer: getSpawnMaxBuffer() });
    return { kind: "pod", name, logs: raw };
  }

  if (resourceType === "deployment") {
    const selectorArgs = ["-n", namespace, "get", "deployment", name, "-o", "jsonpath={.spec.selector.matchLabels}"];
    const selectorJson = (await deps.kubectl(selectorArgs, "kubectl_logs", { maxBuffer: getSpawnMaxBuffer() })).trim();
    const selector = JSON.parse(selectorJson) as Record<string, string>;
    const labelSelector = Object.entries(selector)
      .map(([key, value]) => `${key}=${value}`)
      .join(",");

    return getLabelSelectorLogs(deps, labelSelector, namespace, args);
  }

  if (resourceType === "job") {
    return getLabelSelectorLogs(deps, `job-name=${name}`, namespace, args);
  }

  if (resourceType === "cronjob") {
    const jobsArgs = ["-n", namespace, "get", "jobs", `--selector=job-name=${name}`, "-o", "jsonpath={.items[*].metadata.name}"];
    const jobsRaw = (await deps.kubectl(jobsArgs, "kubectl_logs", { maxBuffer: getSpawnMaxBuffer() })).trim();
    const jobs = jobsRaw ? jobsRaw.split(" ") : [];

    if (jobs.length === 0 || (jobs.length === 1 && jobs[0] === "")) {
      return { kind: "message", message: `No jobs found for cronjob ${name} in namespace ${namespace}` };
    }

    const allJobLogs: Record<string, Record<string, string>> = {};
    for (const job of jobs) {
      const result = await getLabelSelectorLogs(deps, `job-name=${job}`, namespace, args);
      allJobLogs[job] = result.kind === "selector" ? result.logs : {};
    }

    return { kind: "cronjob", cronjob: name, namespace, jobs: allJobLogs };
  }

  if (args.labelSelector) {
    return getLabelSelectorLogs(deps, args.labelSelector, namespace, args);
  }

  throw new KubectlError(`Unsupported resource type: ${resourceType}`, "kubectl_logs", "invalid_input");
}
