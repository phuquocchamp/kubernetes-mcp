import type { PatchResult } from "../operations/patch.js";

export function formatPatch(result: PatchResult): string {
  return result.raw;
}
