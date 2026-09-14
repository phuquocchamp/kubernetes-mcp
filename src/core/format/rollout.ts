import type { RolloutResult } from "../operations/rollout.js";

export function formatRollout(result: RolloutResult): string {
  if (result.watchLimited) {
    return `${result.raw}\n\nNote: Watch operation was limited to 15 seconds. The rollout may still be in progress.`;
  }
  return result.raw;
}
