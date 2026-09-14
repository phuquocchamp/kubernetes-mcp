/**
 * ping — liveness check. No argv, no kubectl/helm call; just confirms the
 * server is responsive.
 */
import type { Deps } from "../types.js";

export type PingResult = Record<string, never>;

export async function ping(_deps: Deps): Promise<PingResult> {
  return {};
}
