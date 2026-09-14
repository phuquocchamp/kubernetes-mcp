import type { CleanupResult } from "../operations/cleanup.js";

export function formatCleanup(result: CleanupResult): string {
  return JSON.stringify(result, null, 2);
}
