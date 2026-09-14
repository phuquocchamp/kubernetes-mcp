/**
 * Operation: node_management
 * Cordon, drain and uncordon Kubernetes nodes. Ported from
 * src/tools/node-management.ts — see docs/REFACTOR-PATTERN.md.
 */
import { getSpawnMaxBuffer } from "../../config/max-buffer.js";
import { KubectlError } from "../errors.js";
import { assertNotFlagLike } from "../security/argv.js";
import type { Deps } from "../types.js";

// The original tool ran every node op (cordon/uncordon/drain, including the
// `get node -o json` status check) with a 5 minute timeout and the
// configured max buffer, via execFileSyncSafe. Keep that explicit — the
// default 60s timeout in core/kubectl.ts is too short for a real drain.
const NODE_OP_OPTS = { timeoutMs: 300_000, maxBuffer: getSpawnMaxBuffer() };

export interface NodeManagementArgs {
  operation: "cordon" | "drain" | "uncordon";
  nodeName?: string;
  force?: boolean;
  gracePeriod?: number;
  deleteLocalData?: boolean;
  ignoreDaemonsets?: boolean;
  timeout?: string;
  dryRun?: boolean;
  confirmDrain?: boolean;
}

export interface NodeManagementResult {
  message: string;
}

interface NodeStatus {
  spec?: { unschedulable?: boolean };
}

function requireNodeName(nodeName: string | undefined, operation: string): string {
  if (!nodeName) {
    throw new KubectlError(`nodeName is required for the "${operation}" operation.`, "node_management", "invalid_input");
  }
  assertNotFlagLike(nodeName, "nodeName");
  return nodeName;
}

async function getNodeStatus(deps: Deps, nodeName: string): Promise<NodeStatus> {
  const raw = await deps.kubectl(["get", "node", nodeName, "-o", "json"], "node_management", NODE_OP_OPTS);
  return JSON.parse(raw) as NodeStatus;
}

async function cordonNode(deps: Deps, nodeName: string): Promise<NodeManagementResult> {
  const nodeStatus = await getNodeStatus(deps, nodeName);
  const isSchedulable = !nodeStatus.spec?.unschedulable;

  if (!isSchedulable) {
    return { message: `Node '${nodeName}' is already cordoned (unschedulable)` };
  }

  await deps.kubectl(["cordon", nodeName], "node_management", NODE_OP_OPTS);
  return { message: `Successfully cordoned node '${nodeName}'. The node is now unschedulable.` };
}

async function uncordonNode(deps: Deps, nodeName: string): Promise<NodeManagementResult> {
  const nodeStatus = await getNodeStatus(deps, nodeName);
  const isSchedulable = !nodeStatus.spec?.unschedulable;

  if (isSchedulable) {
    return { message: `Node '${nodeName}' is already uncordoned (schedulable)` };
  }

  await deps.kubectl(["uncordon", nodeName], "node_management", NODE_OP_OPTS);
  return { message: `Successfully uncordoned node '${nodeName}'. The node is now schedulable.` };
}

interface DrainParams {
  nodeName: string;
  force: boolean;
  gracePeriod: number;
  deleteLocalData: boolean;
  ignoreDaemonsets: boolean;
  timeout: string;
  dryRun: boolean;
  confirmDrain: boolean;
}

async function drainNode(deps: Deps, params: DrainParams): Promise<NodeManagementResult> {
  const { nodeName, force, gracePeriod, deleteLocalData, ignoreDaemonsets, timeout, dryRun, confirmDrain } = params;

  const nodeStatus = await getNodeStatus(deps, nodeName);
  const isSchedulable = !nodeStatus.spec?.unschedulable;

  if (!isSchedulable) {
    return {
      message: `Node '${nodeName}' is already cordoned (unschedulable). Drain operation may not be necessary.`,
    };
  }

  // Safety gate: draining is destructive, so it requires explicit
  // confirmation unless the caller is only doing a dry run. Keep this
  // check exactly as in the original tool.
  if (!dryRun && !confirmDrain) {
    return {
      message: `Drain operation requires explicit confirmation. Set confirmDrain=true to proceed with draining node '${nodeName}'.`,
    };
  }

  const drainArgs = ["drain", nodeName];
  if (force) drainArgs.push("--force");
  if (gracePeriod >= 0) drainArgs.push("--grace-period", gracePeriod.toString());
  if (deleteLocalData) drainArgs.push("--delete-local-data");
  if (ignoreDaemonsets) drainArgs.push("--ignore-daemonsets");
  if (timeout !== "0") drainArgs.push("--timeout", timeout);
  if (dryRun) drainArgs.push("--dry-run=client");

  const drainOutput = await deps.kubectl(drainArgs, "node_management", NODE_OP_OPTS);

  if (dryRun) {
    return {
      message: `Dry run drain operation for node '${nodeName}':\n\n${drainOutput}\n\nTo perform the actual drain, set dryRun=false and confirmDrain=true.`,
    };
  }

  return { message: `Successfully drained node '${nodeName}'.\n\n${drainOutput}` };
}

export async function manageNode(deps: Deps, args: NodeManagementArgs): Promise<NodeManagementResult> {
  const {
    operation,
    nodeName,
    force = false,
    gracePeriod = -1,
    deleteLocalData = false,
    ignoreDaemonsets = true,
    timeout = "0",
    dryRun = false,
    confirmDrain = false,
  } = args;

  switch (operation) {
    case "cordon":
      return cordonNode(deps, requireNodeName(nodeName, operation));
    case "uncordon":
      return uncordonNode(deps, requireNodeName(nodeName, operation));
    case "drain":
      return drainNode(deps, {
        nodeName: requireNodeName(nodeName, operation),
        force,
        gracePeriod,
        deleteLocalData,
        ignoreDaemonsets,
        timeout,
        dryRun,
        confirmDrain,
      });
    default:
      throw new KubectlError(`Unknown operation: ${operation}`, "node_management", "invalid_input");
  }
}
