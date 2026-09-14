import type { NodeManagementResult } from "../operations/node.js";

/**
 * Node management results are already a plain human-readable message in the
 * original tool (no JSON envelope) — keep that exact shape.
 */
export function formatNodeManagement(result: NodeManagementResult): string {
  return result.message;
}
