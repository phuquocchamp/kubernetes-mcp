/**
 * cleanup — release every resource this server session has tracked
 * (created resources, port-forwards, watches). Thin wrapper: all the
 * tracking/teardown logic lives on KubernetesManager.cleanup() already;
 * this does not reimplement it.
 */
import type { Deps } from "../types.js";

export interface CleanupResult {
  success: true;
}

export async function cleanup(deps: Deps): Promise<CleanupResult> {
  await deps.client.cleanup();
  return { success: true };
}
